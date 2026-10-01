// Kirana catalog: what a Siddipet kirana shop usually stocks. No prices — the agent buys at the shop and the
// customer pays as per the shop bill. Customers choose the number of packs.
// [name, brand, pack size, emoji, photo search (Wikimedia Commons) or null, words the photo title must contain]
// Branded packets have no photo search (pack photos are the brands' artwork): they show the emoji tile until the
// admin uploads a photo in Admin → Products.
export const kiranaSections = {
  'Rice & Grains': [
    ['Sona Masoori Rice', '', '25 kg', '🍚', 'sona masoori rice', 'rice'],
    ['Sona Masoori Rice (small bag)', '', '5 kg', '🍚', null],
    ['Basmati Rice', 'India Gate', '1 kg', '🍚', 'basmati rice grains', 'basmati|rice'],
    ['Idli Rice', '', '5 kg', '🍚', null],
    ['Jowar (Jonnalu)', '', '1 kg', '🌾', 'sorghum grains', 'sorghum|jowar'],
    ['Ragi (Finger Millet)', '', '1 kg', '🌾', 'finger millet ragi grains', 'ragi|finger millet|eleusine'],
    ['Wheat (Godhumalu)', '', '5 kg', '🌾', 'wheat grains', 'wheat'],
  ],
  'Atta, Rava & Flours': [
    ['Whole Wheat Atta', 'Aashirvaad', '5 kg', '🌾', null],
    ['Chakki Fresh Atta', 'Pillsbury', '5 kg', '🌾', null],
    ['Maida', '', '1 kg', '🥣', 'all purpose flour maida', 'flour|maida'],
    ['Besan (Senaga Pindi)', '', '500 g', '🥣', 'gram flour besan', 'besan|gram flour|chickpea flour'],
    ['Rice Flour (Biyyam Pindi)', '', '1 kg', '🥣', 'rice flour', 'rice flour'],
    ['Bombay Rava (Upma Rava)', '', '1 kg', '🥣', 'semolina', 'semolina|rava|suji|sooji'],
    ['Idli Rava', '', '1 kg', '🥣', null],
    ['Jowar Flour', '', '1 kg', '🥣', null],
    ['Ragi Flour', '', '1 kg', '🥣', 'ragi flour', 'ragi'],
  ],
  'Dals & Pulses': [
    ['Toor Dal (Kandi Pappu)', '', '1 kg', '🫘', 'toor dal', 'toor|tuvar|arhar|pigeon pea'],
    ['Chana Dal (Senaga Pappu)', '', '1 kg', '🫘', 'chana dal', 'chana dal|bengal gram'],
    ['Moong Dal (Pesara Pappu)', '', '1 kg', '🫘', 'moong dal', 'moong|mung'],
    ['Urad Dal (Minapa Pappu)', '', '1 kg', '🫘', 'urad dal', 'urad|black gram'],
    ['Masoor Dal', '', '1 kg', '🫘', 'masoor dal red lentils', 'masoor|red lentil'],
    ['Green Moong (Whole Pesalu)', '', '500 g', '🫘', 'green gram mung beans', 'mung|moong|green gram'],
    ['Kabuli Chana', '', '1 kg', '🫘', 'chickpeas', 'chickpea|chana|garbanzo'],
    ['Black Chana (Nalla Senagalu)', '', '500 g', '🫘', 'kala chana black chickpeas', 'chana|chickpea'],
    ['Rajma', '', '500 g', '🫘', 'rajma kidney beans', 'kidney bean|rajma'],
    ['Groundnuts (Palli)', '', '500 g', '🥜', 'raw peanuts', 'peanut|groundnut'],
    ['Roasted Chana (Putnalu)', '', '500 g', '🫘', 'roasted gram', 'roasted|gram|chana'],
  ],
  'Oils & Ghee': [
    ['Sunflower Oil', 'Freedom', '1 L', '🛢️', null],
    ['Refined Sunflower Oil', 'Fortune', '1 L', '🛢️', null],
    ['Groundnut Oil', '', '1 L', '🥜', 'groundnut oil', 'groundnut oil|peanut oil'],
    ['Palmolein Oil', '', '1 L', '🛢️', null],
    ['Gingelly (Sesame) Oil', '', '500 ml', '🛢️', 'sesame oil', 'sesame oil|gingelly'],
    ['Mustard Oil', '', '1 L', '🛢️', 'mustard oil', 'mustard oil'],
    ['Coconut Oil', 'Parachute', '500 ml', '🥥', null],
    ['Cow Ghee', 'Heritage', '500 ml', '🧈', 'ghee', 'ghee'],
    ['Vanaspati', 'Dalda', '1 L', '🧈', null],
  ],
  'Spices & Masalas': [
    ['Guntur Red Chilli Powder', '', '500 g', '🌶️', 'red chilli powder', 'chil(l)?i powder'],
    ['Turmeric Powder (Pasupu)', '', '200 g', '🟡', 'turmeric powder', 'turmeric'],
    ['Coriander Powder (Dhaniyalu)', '', '200 g', '🟤', 'coriander powder', 'coriander'],
    ['Cumin Seeds (Jeelakarra)', '', '100 g', '🟤', 'cumin seeds', 'cumin|jeera'],
    ['Mustard Seeds (Avalu)', '', '100 g', '⚫', 'mustard seeds', 'mustard seed'],
    ['Fenugreek Seeds (Menthulu)', '', '100 g', '🟤', 'fenugreek seeds', 'fenugreek'],
    ['Black Pepper (Miriyalu)', '', '100 g', '⚫', 'black pepper', 'pepper'],
    ['Dry Red Chillies (Endu Mirapakayalu)', '', '250 g', '🌶️', 'dried red chillies', 'chil(l)?i'],
    ['Tamarind (Chintapandu)', '', '500 g', '🟤', 'tamarind', 'tamarind'],
    ['Garam Masala', 'Everest', '100 g', '🧂', null],
    ['Chicken Masala', 'Everest', '100 g', '🧂', null],
    ['Sambar Powder', 'MTR', '100 g', '🧂', null],
    ['Rasam Powder', 'MTR', '100 g', '🧂', null],
    ['Ginger Garlic Paste', '', '200 g', '🧄', 'ginger garlic paste', 'ginger garlic'],
    ['Asafoetida (Inguva)', '', '50 g', '🧂', 'asafoetida', 'asafoetida|hing'],
    ['Cloves (Lavangalu)', '', '50 g', '🟤', 'cloves spice', 'clove'],
    ['Cardamom (Yalakulu)', '', '50 g', '🟢', 'green cardamom', 'cardamom'],
    ['Cinnamon (Dalchina Chekka)', '', '50 g', '🟤', 'cinnamon sticks', 'cinnamon'],
  ],
  'Salt, Sugar & Jaggery': [
    ['Iodised Salt', 'Tata', '1 kg', '🧂', null],
    ['Rock Salt', '', '1 kg', '🧂', 'rock salt crystals', 'rock salt|salt crystal|halite'],
    ['Sugar', '', '1 kg', '🍬', 'white sugar', 'sugar'],
    ['Jaggery (Bellam)', '', '1 kg', '🟫', 'jaggery', 'jaggery|gur'],
  ],
  'Tea, Coffee & Health Drinks': [
    ['Tea Powder', 'Red Label', '500 g', '🍵', null],
    ['Tea Powder', '3 Roses', '500 g', '🍵', null],
    ['Tea Powder', 'Taj Mahal', '250 g', '🍵', null],
    ['Instant Coffee', 'Bru', '100 g', '☕', null],
    ['Filter Coffee Powder', '', '500 g', '☕', 'coffee powder', 'coffee'],
    ['Horlicks', 'Horlicks', '500 g', '🥛', null],
    ['Boost', 'Boost', '500 g', '🥛', null],
    ['Bournvita', 'Cadbury', '500 g', '🥛', null],
  ],
  'Breakfast & Instant Food': [
    ['Poha (Atukulu)', '', '500 g', '🥣', 'poha flattened rice', 'poha|flattened rice|beaten rice|aval'],
    ['Vermicelli (Semiya)', 'Bambino', '450 g', '🍜', null],
    ['Oats', 'Saffola', '1 kg', '🥣', null],
    ['Corn Flakes', "Kellogg's", '475 g', '🥣', null],
    ['Upma Mix', 'MTR', '500 g', '🥣', null],
    ['Instant Noodles (4 pack)', 'Maggi', '280 g', '🍜', null],
    ['Instant Noodles', 'Yippee', '4 pack', '🍜', null],
    ['Pasta (Penne)', '', '500 g', '🍝', 'penne pasta', 'penne|pasta'],
  ],
  'Biscuits & Snacks': [
    ['Parle-G Biscuits', 'Parle', '250 g', '🍪', null],
    ['Good Day Biscuits', 'Britannia', '200 g', '🍪', null],
    ['Marie Gold Biscuits', 'Britannia', '250 g', '🍪', null],
    ['Bourbon Biscuits', 'Britannia', '150 g', '🍪', null],
    ['Aloo Bhujia', "Haldiram's", '200 g', '🥨', null],
    ['Potato Chips', "Lay's", '52 g', '🥔', null],
    ['Kurkure', 'Kurkure', '90 g', '🌽', null],
    ['Mixture (Karam Mixture)', '', '250 g', '🥨', null],
  ],
  'Pickles, Sauces & Spreads': [
    ['Mango Pickle (Avakaya)', 'Priya', '300 g', '🥭', null],
    ['Gongura Pickle', 'Priya', '300 g', '🌿', null],
    ['Tomato Ketchup', 'Kissan', '500 g', '🍅', null],
    ['Mixed Fruit Jam', 'Kissan', '500 g', '🍓', null],
    ['Honey', 'Dabur', '250 g', '🍯', 'honey jar', 'honey'],
    ['Synthetic Vinegar', '', '500 ml', '🫙', null],
  ],
  'Dry Fruits & Nuts': [
    ['Cashews', '', '250 g', '🥜', 'cashew nuts', 'cashew'],
    ['Almonds', '', '250 g', '🥜', 'almonds', 'almond'],
    ['Raisins (Kismis)', '', '200 g', '🍇', 'raisins', 'raisin'],
    ['Dates', '', '500 g', '🌴', 'dates fruit', 'date'],
  ],
  'Cleaning & Laundry': [
    ['Detergent Powder', 'Surf Excel Easy Wash', '1 kg', '🧺', null],
    ['Detergent Powder', 'Tide', '1 kg', '🧺', null],
    ['Detergent Bar', 'Rin', '4 × 150 g', '🧼', null],
    ['Dishwash Bar', 'Vim', '3 × 200 g', '🧽', null],
    ['Dishwash Liquid', 'Vim', '500 ml', '🧴', null],
    ['Floor Cleaner', 'Lizol', '500 ml', '🧴', null],
    ['Toilet Cleaner', 'Harpic', '500 ml', '🚽', null],
    ['Phenyl', '', '1 L', '🧴', null],
    ['Scrub Pads', 'Scotch-Brite', '3 pack', '🧽', null],
    ['Garbage Bags (Medium)', '', '30 bags', '🗑️', null],
  ],
  'Personal Care': [
    ['Bath Soap', 'Lifebuoy', '4 × 100 g', '🧼', null],
    ['Bath Soap', 'Santoor', '4 × 100 g', '🧼', null],
    ['Toothpaste', 'Colgate', '200 g', '🪥', null],
    ['Toothbrush', 'Colgate', '2 pack', '🪥', null],
    ['Shampoo', 'Clinic Plus', '175 ml', '🧴', null],
    ['Hair Oil', 'Parachute', '200 ml', '🥥', null],
    ['Hand Wash', 'Dettol', '200 ml', '🧴', null],
    ['Sanitary Pads', 'Whisper', '7 pads', '🩷', null],
    ['Shaving Cream', 'Gillette', '70 g', '🪒', null],
  ],
};

// A shop list in the products format used by setup.js:
// [name, brand, unit, price, mrp, emoji, sold by, photo key, cutting options, section]
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
export function toProducts(sections, prefix) {
  // the brand is shown above the name; only names used by several brands start with the brand ("Red Label Tea Powder")
  const nameCount = Object.values(sections).flat().reduce((m, [n]) => m.set(n, (m.get(n) || 0) + 1), new Map());
  return Object.entries(sections).flatMap(([section, items]) =>
    items.map(([name, brand, unit, icon, query]) => [nameCount.get(name) > 1 && brand ? `${brand} ${name}` : name,
      brand, unit, 0, null, icon, 'pack', query ? `${prefix}:${slug(name)}` : null, null, section])
  );
}
// photo searches for fetch-images.js: { 'kir:toor-dal-kandi-pappu': ['toor dal', /toor|tuvar|.../] }
export const toPhotoQueries = (sections, prefix) => Object.fromEntries(
  Object.values(sections).flat().filter((i) => i[4]).map(([name, , , , query, match]) => [`${prefix}:${slug(name)}`, [query, new RegExp(match, 'i')]])
);

export const kiranaProducts = toProducts(kiranaSections, 'kir');
export const kiranaPhotoQueries = toPhotoQueries(kiranaSections, 'kir');
