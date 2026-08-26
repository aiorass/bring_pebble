// Best-effort category guess from an item's name, used to pick a small icon
// for the watch's list rows. Bring! doesn't expose a category for
// custom/free-text items, so this just keyword-matches the name (Spanish
// first, since that's the primary audience, plus common English terms since
// Bring! catalog items can come through in other locales).

// Must match the ICON_* order in src/c/bring_pebble.c's icon lookup table.
var CATEGORY_DEFAULT = 0;
var CATEGORY_BREAD = 1;
var CATEGORY_DAIRY = 2;
var CATEGORY_FRUIT = 3;
var CATEGORY_VEGETABLE = 4;
var CATEGORY_MEAT = 5;
var CATEGORY_DRINK = 6;
var CATEGORY_CLEANING = 7;

var RULES = [
  { category: CATEGORY_BREAD, words: [
    'pan', 'pan de miga', 'tostado', 'tostadas', 'baguette', 'bread', 'panaderia',
    'panadería', 'factura', 'facturas', 'medialuna', 'medialunas', 'croissant', 'bizcocho'
  ] },
  { category: CATEGORY_DAIRY, words: [
    'leche', 'milk', 'yogur', 'yogurt', 'queso', 'cheese', 'manteca', 'mantequilla',
    'butter', 'crema', 'cream', 'dulce de leche', 'ricota'
  ] },
  { category: CATEGORY_FRUIT, words: [
    'manzana', 'apple', 'banana', 'platano', 'plátano', 'naranja', 'orange', 'pera', 'pear',
    'frutilla', 'fresa', 'strawberry', 'uva', 'uvas', 'grape', 'limon', 'limón', 'lemon',
    'sandia', 'sandía', 'watermelon', 'melon', 'melón', 'kiwi', 'anana', 'ananas', 'piña',
    'pineapple', 'durazno', 'peach', 'ciruela', 'plum', 'mandarina', 'fruta', 'fruit'
  ] },
  { category: CATEGORY_VEGETABLE, words: [
    'lechuga', 'lettuce', 'tomate', 'tomato', 'papa', 'patata', 'potato', 'cebolla', 'onion',
    'zanahoria', 'carrot', 'brocoli', 'brócoli', 'broccoli', 'espinaca', 'spinach', 'pepino',
    'cucumber', 'pimiento', 'pepper', 'ajo', 'garlic', 'zapallo', 'calabaza', 'squash',
    'verdura', 'vegetable', 'vegetal', 'choclo', 'corn'
  ] },
  { category: CATEGORY_MEAT, words: [
    'carne', 'meat', 'pollo', 'chicken', 'pescado', 'fish', 'cerdo', 'pork', 'jamon', 'jamón',
    'ham', 'salchicha', 'sausage', 'milanesa', 'bife', 'steak', 'chorizo', 'hamburguesa',
    'hamburger', 'atun', 'atún', 'tuna', 'huevo', 'huevos', 'egg', 'eggs'
  ] },
  { category: CATEGORY_DRINK, words: [
    'agua', 'water', 'gaseosa', 'soda', 'jugo', 'juice', 'cerveza', 'beer', 'vino', 'wine',
    'cafe', 'café', 'coffee', ' te ', 'té', 'tea', 'bebida', 'drink', 'coca', 'fanta', 'sprite'
  ] },
  { category: CATEGORY_CLEANING, words: [
    'detergente', 'lavandina', 'jabon', 'jabón', 'soap', 'limpiador', 'cleaner', 'shampoo',
    'champu', 'champú', 'papel higienico', 'papel higiénico', 'toilet paper', 'servilleta',
    'servilletas', 'napkin', 'esponja', 'sponge', 'lejia', 'lejía', 'bleach', 'suavizante'
  ] }
];

function categorize(itemName) {
  var name = ' ' + (itemName || '').toLowerCase() + ' ';
  var i, j, rule;
  for (i = 0; i < RULES.length; i++) {
    rule = RULES[i];
    for (j = 0; j < rule.words.length; j++) {
      if (name.indexOf(rule.words[j]) >= 0) {
        return rule.category;
      }
    }
  }
  return CATEGORY_DEFAULT;
}

module.exports = {
  categorize: categorize
};
