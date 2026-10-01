import { toPhotoQueries, toProducts } from './kirana.js';

// Pooja Store: everyday pooja needs. No prices — the agent buys them and the customer pays as per the shop bill.
// Customers can also write their own list or send a photo of it (like Kirana). Goes to regular agents.
// [name, brand, pack size, emoji, photo search (Wikimedia Commons) or null, words the photo title must contain]
export const poojaSections = {
  'Lamps & Oil': [
    ['Clay Diyas (Pramidalu)', '', '12 pcs', '🪔', 'clay diya oil lamps', 'diya|lamp|deepam'],
    ['Deepam Oil', '', '1 L', '🛢️', null],
    ['Cow Ghee for Deepam', '', '200 ml', '🧈', null],
    ['Cotton Wicks (Vattulu)', '', '1 pack', '🪔', 'cotton wicks lamp', 'wick'],
    ['Camphor (Karpooram)', '', '50 g', '🪔', 'camphor tablets', 'camphor'],
  ],
  'Incense': [
    ['Agarbatti (Incense Sticks)', 'Cycle', '1 pack', '🪔', 'incense sticks burning', 'incense|agarbatti'],
    ['Sambrani Cups', '', '12 pcs', '💨', 'sambrani dhoop', 'sambrani|dhoop|frankincense'],
    ['Dhoop Sticks', '', '1 pack', '💨', null],
  ],
  'Kumkum, Pasupu & Gandham': [
    ['Kumkum', '', '50 g', '🔴', 'kumkum powder', 'kumkum|kumkuma|sindoor'],
    ['Pasupu (Turmeric for Pooja)', '', '100 g', '🟡', null],
    ['Gandham (Sandalwood Powder)', '', '50 g', '🟤', 'sandalwood powder', 'sandal'],
    ['Akshintalu (Turmeric Rice)', '', '100 g', '🍚', null],
    ['Vibhuti (Holy Ash)', '', '50 g', '⚪', 'vibhuti holy ash', 'vibhuti|holy ash'],
  ],
  'Flowers & Fresh Items': [
    ['Marigold Garland (Banti Dandalu)', '', '1 garland', '🌼', 'marigold garland', 'marigold|garland'],
    ['Loose Flowers for Pooja', '', '250 g', '🌸', 'flowers for pooja india', 'flower'],
    ['Betel Leaves (Tamalapakulu)', '', '20 leaves', '🍃', 'betel leaves', 'betel'],
    ['Betel Nuts (Vakkalu)', '', '100 g', '🟤', 'areca nuts', 'areca|betel nut'],
    ['Pooja Coconut', '', '1 pc', '🥥', 'coconut husked', 'coconut'],
    ['Bananas for Pooja', '', '1 dozen', '🍌', 'bananas bunch', 'banana'],
  ],
  'Other Pooja Items': [
    ['Pooja Thread (Kankanam)', '', '1 roll', '🧵', null],
    ['Rose Water', '', '100 ml', '🌹', null],
    ['Navadhanyalu (Nine Grains)', '', '1 pack', '🌾', null],
    ['Matchbox', '', '10 boxes', '🔥', null],
  ],
};

export const poojaProducts = toProducts(poojaSections, 'pj');
export const poojaPhotoQueries = toPhotoQueries(poojaSections, 'pj');
