// Finds a related Creative Commons photo (preferably from India) for every category/service keyword
// via the Openverse API and caches it in images.json (committed), so db:setup never needs the network.
// Only missing keywords are fetched; delete an entry from images.json to re-fetch it.
import { readFile, writeFile } from 'node:fs/promises';
import { categories } from './catalog.js';

// keyword -> [search query, words the photo's title/tags must mention]
const QUERIES = {
  'house,cleaning': ['house cleaning india', /clean|sweep|mop|broom|maid/],
  'water,bottle': ['water can india', /water/],
  'water,container': ['water cans india', /water/],
  'water,tank': ['water tank india', /tank/],
  'water,filter': ['water purifier india', /purif|filter/],
  plumber: ['plumber india', /plumb|pipe/],
  electrician: ['electrician india', /electric|wiring/],
  'air,conditioner': ['air conditioner india', /air.?condition|\bac\b/],
  'washing,machine': ['washing machine', /washing machine/],
  refrigerator: ['refrigerator', /fridge|refrigerat/],
  'television,repair': ['tv repair shop india', /\btv\b|television|electronic/],
  carpenter: ['carpenter woodwork india', /carpenter(?! bee)|woodwork/],
  'house,painter': ['house painter india', /paint/],
  'kitchen,cleaning': ['indian kitchen', /kitchen/],
  'pest,control': ['pest control', /pest|fumigat|mosquito|termite/],
  'sofa,carpet': ['sofa living room', /sofa|carpet|couch/],
  laundry: ['dhobi india laundry', /laundr|dhobi|clothes/],
  'ironing,clothes': ['ironing clothes india', /iron|press/],
  'grocery,store': ['kirana store india', /kirana|grocer|shop|store/],
  grocery: ['grocery shop india', /kirana|grocer|shop|store/],
  vegetables: ['vegetable market india', /vegetable/],
  fruits: ['fruit stall india', /fruit/],
  milk: ['milk delivery india', /milk/],
  eggs: ['eggs india', /\beggs?\b/],
  'bakery,bread': ['bakery india', /bak|bread|naan|pav/],
  'chicken,meat': ['chicken shop india', /chicken|meat|butcher/],
  'fish,market': ['fish market india', /fish/],
  coconut: ['tender coconut india', /coconut/],
  'gas,cylinder': ['lpg cylinder india', /cylinder|lpg/],
  'pet,food': ['dog food', /food/],
  'groceries,basket': ['groceries', /grocer/],
  pharmacy: ['pharmacy india', /pharmac|chemist|medical/],
  'pharmacy,medicine': ['medicine tablets', /medic|tablet|pill/],
  prescription: ['doctor prescription', /prescription/],
  'laboratory,test': ['pathology laboratory', /lab|patholog/],
  'blood,test': ['blood test tube', /blood (test|sample)|test tube/],
  doctor: ['doctor clinic india', /doctor|clinic/],
  physiotherapy: ['physiotherapy', /physio/],
  'elderly,care': ['elderly care india', /elder|senior|grand|old (wo)?man/],
  'medical,equipment': ['hospital bed', /hospital|medical/],
  wheelchair: ['wheelchair', /wheelchair/],
  'pharmacy,night': ['chemist shop india', /pharmac|chemist|medical/],
  'car,mechanic': ['car mechanic india', /mechanic|garage/],
  'motorcycle,tire': ['puncture repair india', /puncture|tyre|tire/],
  'motorcycle,repair': ['motorcycle mechanic india', /mechanic|repair/],
  'car,tire': ['car tyre', /tyre|tire/],
  'car,wash': ['car wash india', /car ?wash|washing/],
  'motorcycle,wash': ['bike wash', /wash/],
  'car,detailing': ['car detailing', /detail|polish|wax/],
  'car,battery': ['car battery', /battery/],
  'tow,truck': ['tow truck', /tow/],
  'car,service': ['car garage india', /garage|mechanic|service/],
  motorcycle: ['royal enfield india', /motorcycle|bike|enfield/],
  'used,car': ['maruti car india', /car|maruti/],
  'family,home': ['indian family', /family/],
  barber: ['barber india', /barber|haircut|shave/],
  'beauty,salon': ['beauty salon india', /salon|beauty|facial|mehndi|henna/],
  'tailor,sewing': ['tailor india', /tailor|sewing/],
  'shoe,repair': ['cobbler india', /cobbler|shoe/],
  'bag,leather': ['bag repair', /bag/],
  'watch,repair': ['watch repair', /watch/],
  'smartphone,repair': ['mobile phone repair shop', /phone|mobile/],
  'laptop,repair': ['laptop repair', /laptop|computer/],
  'tutor,student': ['tuition class india', /tuition|tutor|student|class/],
  'school,books': ['school children books india', /school|book/],
  'baby,products': ['baby products', /baby|diaper/],
  'dog,grooming': ['dog grooming', /groom|bath/],
  'dog,walking': ['dog walking', /walk/],
  recycling: ['recycling india', /recycl/],
  'scrap,metal': ['scrap dealer india', /scrap|kabad/],
  'paper,recycling': ['newspaper recycling india', /paper/],
  'plastic,recycling': ['plastic recycling india', /plastic/],
  'electronic,waste': ['e-waste india', /e-?waste|electronic/],
  'old,furniture': ['old furniture', /furniture|chair|sofa/],
  'old,appliance': ['old appliances', /appliance|fridge|washing|tv/],
  'garden,leaves': ['garden waste leaves', /lea(f|ves)|garden/],
  'junk,removal': ['junk pile', /junk|clutter|rubbish/],
  'delivery,courier': ['delivery boy india', /deliver|courier/],
  'parcel,delivery': ['parcel delivery india', /parcel|package|deliver/],
  'shopping,bags': ['shopping bags india', /shopping|bags?/],
  'documents,envelope': ['documents envelope', /document|envelope/],
  medicine: ['medicine tablets', /medic|tablet|pill/],
  'laundry,basket': ['laundry basket', /laundry/],
  'water,jug': ['water can delivery india', /water/],
  'furniture,moving': ['packers movers india', /mov|packer|shifting/],
  'moving,boxes': ['moving boxes', /box/],
  'courier,scooter': ['delivery scooter india', /scooter|deliver|courier/],
};

const CACHE = new URL('./images.json', import.meta.url);
const DELAY_MS = 3500; // Openverse anonymous rate limit is ~20 requests/minute
const JUNK = /logo|png|clip ?art|icon|calendar|wallpaper|poster|republican|kitten|leopard|stain|operation/i;
const INDIA = /india|indian|mumbai|delhi|bangalore|bengaluru|chennai|hyderabad|kolkata|calcutta|kerala|pune|jaipur|goa|tamil|karnataka|andhra|telangana|rajasthan/i;

const cache = JSON.parse(await readFile(CACHE, 'utf8').catch(() => '{}'));
const keywords = [...new Set(categories.flatMap((c) => [c.image, ...c.services.map((s) => s[1])]))];
const missing = keywords.filter((k) => !cache[k]);
console.log(`${keywords.length} keywords, ${missing.length} to fetch`);

// Flickr "_b" (1024px) → "_z" (640px) keeps cards light.
const smaller = (url) => url.replace(/_b\.jpg$/, '_z.jpg');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (r) => [r.title, ...(r.tags || []).map((t) => t.name)].join(' ');
const usable = (r) => r.width >= 400 && r.height >= 250 && r.width >= r.height && !JUNK.test(text(r));

// Best first: subject in the title and Indian, subject in the title, subject only in tags and Indian.
function choose(results, subject) {
  const re = new RegExp(subject.source, 'i');
  const ok = results.filter(usable);
  return (
    ok.find((r) => re.test(r.title) && INDIA.test(text(r))) ||
    ok.find((r) => re.test(r.title)) ||
    ok.find((r) => re.test(text(r)) && INDIA.test(text(r)))
  );
}

async function search(q) {
  const res = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=20&extension=jpg&mature=false`);
  if (res.status === 429) throw new Error('rate-limited');
  return (await res.json()).results || [];
}

try {
  for (const kw of missing) {
    const [q, subject] = QUERIES[kw] || [`${kw.replace(/,/g, ' ')} india`, new RegExp(kw.split(',')[0], 'i')];
    let pick = choose(await search(q), subject);
    if (!pick && / india$/.test(q)) {
      await sleep(DELAY_MS);
      pick = choose(await search(q.replace(/ india$/, '')), subject);
    }
    if (pick) {
      const indian = INDIA.test(text(pick));
      cache[kw] = { url: smaller(pick.url), credit: pick.attribution, source: pick.foreign_landing_url, india: indian };
      console.log(`${indian ? 'IN' : '--'} ${kw}: ${pick.title}`);
    } else {
      console.log(`xx ${kw}: no on-topic photo found`);
    }
    await writeFile(CACHE, JSON.stringify(cache, null, 2));
    await sleep(DELAY_MS);
  }
} catch (err) {
  if (err.message !== 'rate-limited') throw err;
  console.log('Rate limited — progress saved; run again in a few minutes.');
}
