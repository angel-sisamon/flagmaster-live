/**
 * js/countries-data.js
 * 195 países con nombres en 4 idiomas (es/en/fr/pt), emoji de bandera y capital en 4 idiomas.
 *
 * DECISIÓN DE ARQUITECTURA — JSON vs inline JS:
 * ─────────────────────────────────────────────────────────────────
 * ¿Por qué inline JS y no un countries.json?
 *
 *   JSON pros:  Más fácil de editar manualmente, semánticamente "más limpio".
 *   JSON cons:  Requiere fetch() → código asíncrono, manejo de errores de red,
 *               NO funciona con file:// en escritorio, y para Capacitor añade
 *               complejidad de inicialización sin ningún beneficio de tamaño.
 *
 *   CONCLUSIÓN: Para una app mobile empaquetada (Capacitor/WebView) que debe
 *   ser 100% offline, el inline JS es la opción óptima. El dato es inmutable
 *   en runtime y se carga de forma síncrona sin overhead.
 *
 * Para añadir un idioma nuevo (ej. alemán):
 *   Añadir la clave 'de' al objeto 'names' y 'capitals' de cada país.
 *   El helper cn() y cap() en utils.js lo resuelven automáticamente.
 *
 * Fallback de idioma en cn() / cap(): en → es → code
 *   Si el idioma activo no tiene traducción, se usa inglés como puente universal.
 */

var COUNTRIES = [

  /* ── Europa ─────────────────────────────────────────── */
  {code:'AD',flag:'🇦🇩',names:{es:'Andorra',              en:'Andorra',                  fr:'Andorre',                    pt:'Andorra'},               capitals:{es:'Andorra la Vella',    en:'Andorra la Vella',    fr:'Andorre-la-Vieille',   pt:'Andorra la Vella'}},
  {code:'AL',flag:'🇦🇱',names:{es:'Albania',              en:'Albania',                  fr:'Albanie',                    pt:'Albânia'},               capitals:{es:'Tirana',              en:'Tirana',              fr:'Tirana',               pt:'Tirana'}},
  {code:'AT',flag:'🇦🇹',names:{es:'Austria',              en:'Austria',                  fr:'Autriche',                   pt:'Áustria'},               capitals:{es:'Viena',               en:'Vienna',              fr:'Vienne',               pt:'Viena'}},
  {code:'BA',flag:'🇧🇦',names:{es:'Bosnia y Herzegovina', en:'Bosnia and Herzegovina',   fr:'Bosnie-Herzégovine',         pt:'Bósnia e Herzegovina'},  capitals:{es:'Sarajevo',            en:'Sarajevo',            fr:'Sarajevo',             pt:'Sarajevo'}},
  {code:'BE',flag:'🇧🇪',names:{es:'Bélgica',              en:'Belgium',                  fr:'Belgique',                   pt:'Bélgica'},               capitals:{es:'Bruselas',            en:'Brussels',            fr:'Bruxelles',            pt:'Bruxelas'}},
  {code:'BG',flag:'🇧🇬',names:{es:'Bulgaria',             en:'Bulgaria',                 fr:'Bulgarie',                   pt:'Bulgária'},              capitals:{es:'Sofía',               en:'Sofia',               fr:'Sofia',                pt:'Sófia'}},
  {code:'BY',flag:'🇧🇾',names:{es:'Bielorrusia',          en:'Belarus',                  fr:'Biélorussie',                pt:'Bielorrússia'},          capitals:{es:'Minsk',               en:'Minsk',               fr:'Minsk',                pt:'Minsk'}},
  {code:'CH',flag:'🇨🇭',names:{es:'Suiza',                en:'Switzerland',              fr:'Suisse',                     pt:'Suíça'},                 capitals:{es:'Berna',               en:'Bern',                fr:'Berne',                pt:'Berna'}},
  {code:'CY',flag:'🇨🇾',names:{es:'Chipre',               en:'Cyprus',                   fr:'Chypre',                     pt:'Chipre'},                capitals:{es:'Nicosia',             en:'Nicosia',             fr:'Nicosie',              pt:'Nicósia'}},
  {code:'CZ',flag:'🇨🇿',names:{es:'República Checa',      en:'Czech Republic',           fr:'République tchèque',         pt:'República Tcheca'},      capitals:{es:'Praga',               en:'Prague',              fr:'Prague',               pt:'Praga'}},
  {code:'DE',flag:'🇩🇪',names:{es:'Alemania',             en:'Germany',                  fr:'Allemagne',                  pt:'Alemanha'},              capitals:{es:'Berlín',              en:'Berlin',              fr:'Berlin',               pt:'Berlim'}},
  {code:'DK',flag:'🇩🇰',names:{es:'Dinamarca',            en:'Denmark',                  fr:'Danemark',                   pt:'Dinamarca'},             capitals:{es:'Copenhague',          en:'Copenhagen',          fr:'Copenhague',           pt:'Copenhague'}},
  {code:'EE',flag:'🇪🇪',names:{es:'Estonia',              en:'Estonia',                  fr:'Estonie',                    pt:'Estônia'},               capitals:{es:'Tallin',              en:'Tallinn',             fr:'Tallinn',              pt:'Tallinn'}},
  {code:'ES',flag:'🇪🇸',names:{es:'España',               en:'Spain',                    fr:'Espagne',                    pt:'Espanha'},               capitals:{es:'Madrid',              en:'Madrid',              fr:'Madrid',               pt:'Madrid'}},
  {code:'FI',flag:'🇫🇮',names:{es:'Finlandia',            en:'Finland',                  fr:'Finlande',                   pt:'Finlândia'},             capitals:{es:'Helsinki',            en:'Helsinki',            fr:'Helsinki',             pt:'Helsinque'}},
  {code:'FR',flag:'🇫🇷',names:{es:'Francia',              en:'France',                   fr:'France',                     pt:'França'},                capitals:{es:'París',               en:'Paris',               fr:'Paris',                pt:'Paris'}},
  {code:'GB',flag:'🇬🇧',names:{es:'Reino Unido',          en:'United Kingdom',           fr:'Royaume-Uni',                pt:'Reino Unido'},           capitals:{es:'Londres',             en:'London',              fr:'Londres',              pt:'Londres'}},
  {code:'GR',flag:'🇬🇷',names:{es:'Grecia',               en:'Greece',                   fr:'Grèce',                      pt:'Grécia'},                capitals:{es:'Atenas',              en:'Athens',              fr:'Athènes',              pt:'Atenas'}},
  {code:'HR',flag:'🇭🇷',names:{es:'Croacia',              en:'Croatia',                  fr:'Croatie',                    pt:'Croácia'},               capitals:{es:'Zagreb',              en:'Zagreb',              fr:'Zagreb',               pt:'Zagreb'}},
  {code:'HU',flag:'🇭🇺',names:{es:'Hungría',              en:'Hungary',                  fr:'Hongrie',                    pt:'Hungria'},               capitals:{es:'Budapest',            en:'Budapest',            fr:'Budapest',             pt:'Budapeste'}},
  {code:'IE',flag:'🇮🇪',names:{es:'Irlanda',              en:'Ireland',                  fr:'Irlande',                    pt:'Irlanda'},               capitals:{es:'Dublín',              en:'Dublin',              fr:'Dublin',               pt:'Dublin'}},
  {code:'IS',flag:'🇮🇸',names:{es:'Islandia',             en:'Iceland',                  fr:'Islande',                    pt:'Islândia'},              capitals:{es:'Reikiavik',           en:'Reykjavik',           fr:'Reykjavik',            pt:'Reykjavik'}},
  {code:'IT',flag:'🇮🇹',names:{es:'Italia',               en:'Italy',                    fr:'Italie',                     pt:'Itália'},                capitals:{es:'Roma',                en:'Rome',                fr:'Rome',                 pt:'Roma'}},
  {code:'LI',flag:'🇱🇮',names:{es:'Liechtenstein',        en:'Liechtenstein',            fr:'Liechtenstein',              pt:'Liechtenstein'},         capitals:{es:'Vaduz',               en:'Vaduz',               fr:'Vaduz',                pt:'Vaduz'}},
  {code:'LT',flag:'🇱🇹',names:{es:'Lituania',             en:'Lithuania',                fr:'Lituanie',                   pt:'Lituânia'},              capitals:{es:'Vilna',               en:'Vilnius',             fr:'Vilnius',              pt:'Vilnius'}},
  {code:'LU',flag:'🇱🇺',names:{es:'Luxemburgo',           en:'Luxembourg',               fr:'Luxembourg',                 pt:'Luxemburgo'},            capitals:{es:'Luxemburgo',          en:'Luxembourg City',     fr:'Luxembourg',           pt:'Luxemburgo'}},
  {code:'LV',flag:'🇱🇻',names:{es:'Letonia',              en:'Latvia',                   fr:'Lettonie',                   pt:'Letônia'},               capitals:{es:'Riga',                en:'Riga',                fr:'Riga',                 pt:'Riga'}},
  {code:'MC',flag:'🇲🇨',names:{es:'Mónaco',               en:'Monaco',                   fr:'Monaco',                     pt:'Mônaco'},                capitals:{es:'Mónaco',              en:'Monaco',              fr:'Monaco',               pt:'Mônaco'}},
  {code:'MD',flag:'🇲🇩',names:{es:'Moldavia',             en:'Moldova',                  fr:'Moldavie',                   pt:'Moldávia'},              capitals:{es:'Chisináu',            en:'Chișinău',            fr:'Chișinău',             pt:'Chișinău'}},
  {code:'ME',flag:'🇲🇪',names:{es:'Montenegro',           en:'Montenegro',               fr:'Monténégro',                 pt:'Montenegro'},            capitals:{es:'Podgorica',           en:'Podgorica',           fr:'Podgorica',            pt:'Podgorica'}},
  {code:'MK',flag:'🇲🇰',names:{es:'Macedonia del Norte',  en:'North Macedonia',          fr:'Macédoine du Nord',          pt:'Macedônia do Norte'},    capitals:{es:'Skopie',              en:'Skopje',              fr:'Skopje',               pt:'Skopje'}},
  {code:'MT',flag:'🇲🇹',names:{es:'Malta',                en:'Malta',                    fr:'Malte',                      pt:'Malta'},                 capitals:{es:'La Valeta',           en:'Valletta',            fr:'La Valette',           pt:'Valletta'}},
  {code:'NL',flag:'🇳🇱',names:{es:'Países Bajos',         en:'Netherlands',              fr:'Pays-Bas',                   pt:'Países Baixos'},         capitals:{es:'Ámsterdam',           en:'Amsterdam',           fr:'Amsterdam',            pt:'Amsterdã'}},
  {code:'NO',flag:'🇳🇴',names:{es:'Noruega',              en:'Norway',                   fr:'Norvège',                    pt:'Noruega'},               capitals:{es:'Oslo',                en:'Oslo',                fr:'Oslo',                 pt:'Oslo'}},
  {code:'PL',flag:'🇵🇱',names:{es:'Polonia',              en:'Poland',                   fr:'Pologne',                    pt:'Polônia'},               capitals:{es:'Varsovia',            en:'Warsaw',              fr:'Varsovie',             pt:'Varsóvia'}},
  {code:'PT',flag:'🇵🇹',names:{es:'Portugal',             en:'Portugal',                 fr:'Portugal',                   pt:'Portugal'},              capitals:{es:'Lisboa',              en:'Lisbon',              fr:'Lisbonne',             pt:'Lisboa'}},
  {code:'RO',flag:'🇷🇴',names:{es:'Rumanía',              en:'Romania',                  fr:'Roumanie',                   pt:'Romênia'},               capitals:{es:'Bucarest',            en:'Bucharest',           fr:'Bucarest',             pt:'Bucareste'}},
  {code:'RS',flag:'🇷🇸',names:{es:'Serbia',               en:'Serbia',                   fr:'Serbie',                     pt:'Sérvia'},                capitals:{es:'Belgrado',            en:'Belgrade',            fr:'Belgrade',             pt:'Belgrado'}},
  {code:'RU',flag:'🇷🇺',names:{es:'Rusia',                en:'Russia',                   fr:'Russie',                     pt:'Rússia'},                capitals:{es:'Moscú',               en:'Moscow',              fr:'Moscou',               pt:'Moscou'}},
  {code:'SE',flag:'🇸🇪',names:{es:'Suecia',               en:'Sweden',                   fr:'Suède',                      pt:'Suécia'},                capitals:{es:'Estocolmo',           en:'Stockholm',           fr:'Stockholm',            pt:'Estocolmo'}},
  {code:'SI',flag:'🇸🇮',names:{es:'Eslovenia',            en:'Slovenia',                 fr:'Slovénie',                   pt:'Eslovênia'},             capitals:{es:'Liubliana',           en:'Ljubljana',           fr:'Ljubljana',            pt:'Liubliana'}},
  {code:'SK',flag:'🇸🇰',names:{es:'Eslovaquia',           en:'Slovakia',                 fr:'Slovaquie',                  pt:'Eslováquia'},            capitals:{es:'Bratislava',          en:'Bratislava',          fr:'Bratislava',           pt:'Bratislava'}},
  {code:'SM',flag:'🇸🇲',names:{es:'San Marino',           en:'San Marino',               fr:'Saint-Marin',                pt:'San Marino'},            capitals:{es:'San Marino',          en:'San Marino',          fr:'Saint-Marin',          pt:'San Marino'}},
  {code:'TR',flag:'🇹🇷',names:{es:'Turquía',              en:'Turkey',                   fr:'Turquie',                    pt:'Turquia'},               capitals:{es:'Ankara',              en:'Ankara',              fr:'Ankara',               pt:'Ancara'}},
  {code:'UA',flag:'🇺🇦',names:{es:'Ucrania',              en:'Ukraine',                  fr:'Ukraine',                    pt:'Ucrânia'},               capitals:{es:'Kiev',                en:'Kyiv',                fr:'Kiev',                 pt:'Kiev'}},
  {code:'VA',flag:'🇻🇦',names:{es:'Ciudad del Vaticano',  en:'Vatican City',             fr:'Vatican',                    pt:'Vaticano'},              capitals:{es:'Ciudad del Vaticano', en:'Vatican City',        fr:'Vatican',              pt:'Vaticano'}},
  {code:'XK',flag:'🇽🇰',names:{es:'Kosovo',               en:'Kosovo',                   fr:'Kosovo',                     pt:'Kosovo'},                capitals:{es:'Pristina',            en:'Pristina',            fr:'Pristina',             pt:'Pristina'}},

  /* ── América del Norte y Central ─────────────────── */
  {code:'AG',flag:'🇦🇬',names:{es:'Antigua y Barbuda',    en:'Antigua and Barbuda',      fr:'Antigua-et-Barbuda',         pt:'Antígua e Barbuda'},     capitals:{es:'Saint John\'s',       en:'Saint John\'s',       fr:'Saint John\'s',        pt:'Saint John\'s'}},
  {code:'BB',flag:'🇧🇧',names:{es:'Barbados',             en:'Barbados',                 fr:'Barbade',                    pt:'Barbados'},              capitals:{es:'Bridgetown',          en:'Bridgetown',          fr:'Bridgetown',           pt:'Bridgetown'}},
  {code:'BZ',flag:'🇧🇿',names:{es:'Belice',               en:'Belize',                   fr:'Belize',                     pt:'Belize'},                capitals:{es:'Belmopán',            en:'Belmopan',            fr:'Belmopan',             pt:'Belmopã'}},
  {code:'CA',flag:'🇨🇦',names:{es:'Canadá',               en:'Canada',                   fr:'Canada',                     pt:'Canadá'},                capitals:{es:'Ottawa',              en:'Ottawa',              fr:'Ottawa',               pt:'Ottawa'}},
  {code:'CR',flag:'🇨🇷',names:{es:'Costa Rica',           en:'Costa Rica',               fr:'Costa Rica',                 pt:'Costa Rica'},            capitals:{es:'San José',            en:'San José',            fr:'San José',             pt:'São José'}},
  {code:'CU',flag:'🇨🇺',names:{es:'Cuba',                 en:'Cuba',                     fr:'Cuba',                       pt:'Cuba'},                  capitals:{es:'La Habana',           en:'Havana',              fr:'La Havane',            pt:'Havana'}},
  {code:'DM',flag:'🇩🇲',names:{es:'Dominica',             en:'Dominica',                 fr:'Dominique',                  pt:'Dominica'},              capitals:{es:'Roseau',              en:'Roseau',              fr:'Roseau',               pt:'Roseau'}},
  {code:'DO',flag:'🇩🇴',names:{es:'Rep. Dominicana',      en:'Dominican Republic',       fr:'République dominicaine',     pt:'República Dominicana'},  capitals:{es:'Santo Domingo',       en:'Santo Domingo',       fr:'Saint-Domingue',       pt:'Santo Domingo'}},
  {code:'GD',flag:'🇬🇩',names:{es:'Granada',              en:'Grenada',                  fr:'Grenade',                    pt:'Granada'},               capitals:{es:'Saint George\'s',     en:'Saint George\'s',     fr:'Saint-Georges',        pt:'Saint George\'s'}},
  {code:'GT',flag:'🇬🇹',names:{es:'Guatemala',            en:'Guatemala',                fr:'Guatemala',                  pt:'Guatemala'},             capitals:{es:'Guatemala',           en:'Guatemala City',      fr:'Guatemala',            pt:'Cidade da Guatemala'}},
  {code:'HN',flag:'🇭🇳',names:{es:'Honduras',             en:'Honduras',                 fr:'Honduras',                   pt:'Honduras'},              capitals:{es:'Tegucigalpa',         en:'Tegucigalpa',         fr:'Tegucigalpa',          pt:'Tegucigalpa'}},
  {code:'HT',flag:'🇭🇹',names:{es:'Haití',                en:'Haiti',                    fr:'Haïti',                      pt:'Haiti'},                 capitals:{es:'Puerto Príncipe',     en:'Port-au-Prince',      fr:'Port-au-Prince',       pt:'Porto Príncipe'}},
  {code:'JM',flag:'🇯🇲',names:{es:'Jamaica',              en:'Jamaica',                  fr:'Jamaïque',                   pt:'Jamaica'},               capitals:{es:'Kingston',            en:'Kingston',            fr:'Kingston',             pt:'Kingston'}},
  {code:'KN',flag:'🇰🇳',names:{es:'San Cristóbal y Nieves',en:'Saint Kitts and Nevis',  fr:'Saint-Kitts-et-Nevis',       pt:'São Cristóvão e Neves'}, capitals:{es:'Basseterre',          en:'Basseterre',          fr:'Basseterre',           pt:'Basseterre'}},
  {code:'LC',flag:'🇱🇨',names:{es:'Santa Lucía',          en:'Saint Lucia',              fr:'Sainte-Lucie',               pt:'Santa Lúcia'},           capitals:{es:'Castries',            en:'Castries',            fr:'Castries',             pt:'Castries'}},
  {code:'MX',flag:'🇲🇽',names:{es:'México',               en:'Mexico',                   fr:'Mexique',                    pt:'México'},                capitals:{es:'Ciudad de México',    en:'Mexico City',         fr:'Mexico',               pt:'Cidade do México'}},
  {code:'NI',flag:'🇳🇮',names:{es:'Nicaragua',            en:'Nicaragua',                fr:'Nicaragua',                  pt:'Nicarágua'},             capitals:{es:'Managua',             en:'Managua',             fr:'Managua',              pt:'Manágua'}},
  {code:'PA',flag:'🇵🇦',names:{es:'Panamá',               en:'Panama',                   fr:'Panama',                     pt:'Panamá'},                capitals:{es:'Ciudad de Panamá',    en:'Panama City',         fr:'Panama',               pt:'Cidade do Panamá'}},
  {code:'SV',flag:'🇸🇻',names:{es:'El Salvador',          en:'El Salvador',              fr:'Salvador',                   pt:'El Salvador'},           capitals:{es:'San Salvador',        en:'San Salvador',        fr:'San Salvador',         pt:'São Salvador'}},
  {code:'TT',flag:'🇹🇹',names:{es:'Trinidad y Tobago',    en:'Trinidad and Tobago',      fr:'Trinité-et-Tobago',          pt:'Trinidad e Tobago'},     capitals:{es:'Puerto España',       en:'Port of Spain',       fr:'Port of Spain',        pt:'Porto de Espanha'}},
  {code:'US',flag:'🇺🇸',names:{es:'Estados Unidos',       en:'United States',            fr:'États-Unis',                 pt:'Estados Unidos'},        capitals:{es:'Washington D.C.',     en:'Washington D.C.',     fr:'Washington D.C.',      pt:'Washington D.C.'}},
  {code:'VC',flag:'🇻🇨',names:{es:'San Vicente y las Granadinas',en:'Saint Vincent and the Grenadines',fr:'Saint-Vincent-et-les-Grenadines',pt:'São Vicente e Granadinas'},capitals:{es:'Kingstown',en:'Kingstown',fr:'Kingstown',pt:'Kingstown'}},

  /* ── América del Sur ──────────────────────────────── */
  {code:'AR',flag:'🇦🇷',names:{es:'Argentina',            en:'Argentina',                fr:'Argentine',                  pt:'Argentina'},             capitals:{es:'Buenos Aires',        en:'Buenos Aires',        fr:'Buenos Aires',         pt:'Buenos Aires'}},
  {code:'BO',flag:'🇧🇴',names:{es:'Bolivia',              en:'Bolivia',                  fr:'Bolivie',                    pt:'Bolívia'},               capitals:{es:'La Paz',              en:'La Paz',              fr:'La Paz',               pt:'La Paz'}},
  {code:'BR',flag:'🇧🇷',names:{es:'Brasil',               en:'Brazil',                   fr:'Brésil',                     pt:'Brasil'},                capitals:{es:'Brasilia',            en:'Brasília',            fr:'Brasilia',             pt:'Brasília'}},
  {code:'CL',flag:'🇨🇱',names:{es:'Chile',                en:'Chile',                    fr:'Chili',                      pt:'Chile'},                 capitals:{es:'Santiago',            en:'Santiago',            fr:'Santiago',             pt:'Santiago'}},
  {code:'CO',flag:'🇨🇴',names:{es:'Colombia',             en:'Colombia',                 fr:'Colombie',                   pt:'Colômbia'},              capitals:{es:'Bogotá',              en:'Bogotá',              fr:'Bogotá',               pt:'Bogotá'}},
  {code:'EC',flag:'🇪🇨',names:{es:'Ecuador',              en:'Ecuador',                  fr:'Équateur',                   pt:'Equador'},               capitals:{es:'Quito',               en:'Quito',               fr:'Quito',                pt:'Quito'}},
  {code:'GY',flag:'🇬🇾',names:{es:'Guyana',               en:'Guyana',                   fr:'Guyana',                     pt:'Guiana'},                capitals:{es:'Georgetown',          en:'Georgetown',          fr:'Georgetown',           pt:'Georgetown'}},
  {code:'PE',flag:'🇵🇪',names:{es:'Perú',                 en:'Peru',                     fr:'Pérou',                      pt:'Peru'},                  capitals:{es:'Lima',                en:'Lima',                fr:'Lima',                 pt:'Lima'}},
  {code:'PY',flag:'🇵🇾',names:{es:'Paraguay',             en:'Paraguay',                 fr:'Paraguay',                   pt:'Paraguai'},              capitals:{es:'Asunción',            en:'Asunción',            fr:'Asunción',             pt:'Assunção'}},
  {code:'SR',flag:'🇸🇷',names:{es:'Surinam',              en:'Suriname',                 fr:'Suriname',                   pt:'Suriname'},              capitals:{es:'Paramaribo',          en:'Paramaribo',          fr:'Paramaribo',           pt:'Paramaribo'}},
  {code:'UY',flag:'🇺🇾',names:{es:'Uruguay',              en:'Uruguay',                  fr:'Uruguay',                    pt:'Uruguai'},               capitals:{es:'Montevideo',          en:'Montevideo',          fr:'Montevideo',           pt:'Montevidéu'}},
  {code:'VE',flag:'🇻🇪',names:{es:'Venezuela',            en:'Venezuela',                fr:'Venezuela',                  pt:'Venezuela'},             capitals:{es:'Caracas',             en:'Caracas',             fr:'Caracas',              pt:'Caracas'}},

  /* ── Asia ─────────────────────────────────────────── */
  {code:'AE',flag:'🇦🇪',names:{es:'Emiratos Árabes',      en:'UAE',                      fr:'Émirats arabes unis',        pt:'Emirados Árabes'},       capitals:{es:'Abu Dabi',            en:'Abu Dhabi',           fr:'Abou Dabi',            pt:'Abu Dhabi'}},
  {code:'AF',flag:'🇦🇫',names:{es:'Afganistán',           en:'Afghanistan',              fr:'Afghanistan',                pt:'Afeganistão'},           capitals:{es:'Kabul',               en:'Kabul',               fr:'Kaboul',               pt:'Cabul'}},
  {code:'AM',flag:'🇦🇲',names:{es:'Armenia',              en:'Armenia',                  fr:'Arménie',                    pt:'Armênia'},               capitals:{es:'Ereván',              en:'Yerevan',             fr:'Erevan',               pt:'Erevan'}},
  {code:'AZ',flag:'🇦🇿',names:{es:'Azerbaiyán',           en:'Azerbaijan',               fr:'Azerbaïdjan',                pt:'Azerbaijão'},            capitals:{es:'Bakú',                en:'Baku',                fr:'Bakou',                pt:'Baku'}},
  {code:'BD',flag:'🇧🇩',names:{es:'Bangladés',            en:'Bangladesh',               fr:'Bangladesh',                 pt:'Bangladesh'},            capitals:{es:'Daca',                en:'Dhaka',               fr:'Dacca',                pt:'Daca'}},
  {code:'BH',flag:'🇧🇭',names:{es:'Baréin',               en:'Bahrain',                  fr:'Bahreïn',                    pt:'Bahrein'},               capitals:{es:'Manama',              en:'Manama',              fr:'Manama',               pt:'Manama'}},
  {code:'BN',flag:'🇧🇳',names:{es:'Brunéi',               en:'Brunei',                   fr:'Brunei',                     pt:'Brunei'},                capitals:{es:'Bandar Seri Begawan', en:'Bandar Seri Begawan', fr:'Bandar Seri Begawan',  pt:'Bandar Seri Begawan'}},
  {code:'BT',flag:'🇧🇹',names:{es:'Bután',                en:'Bhutan',                   fr:'Bhoutan',                    pt:'Butão'},                 capitals:{es:'Timbu',               en:'Thimphu',             fr:'Thimphou',             pt:'Timphu'}},
  {code:'CN',flag:'🇨🇳',names:{es:'China',                en:'China',                    fr:'Chine',                      pt:'China'},                 capitals:{es:'Pekín',               en:'Beijing',             fr:'Pékin',                pt:'Pequim'}},
  {code:'GE',flag:'🇬🇪',names:{es:'Georgia',              en:'Georgia',                  fr:'Géorgie',                    pt:'Geórgia'},               capitals:{es:'Tiflis',              en:'Tbilisi',             fr:'Tbilissi',             pt:'Tbilisi'}},
  {code:'ID',flag:'🇮🇩',names:{es:'Indonesia',            en:'Indonesia',                fr:'Indonésie',                  pt:'Indonésia'},             capitals:{es:'Yakarta',             en:'Jakarta',             fr:'Jakarta',              pt:'Jacarta'}},
  {code:'IL',flag:'🇮🇱',names:{es:'Israel',               en:'Israel',                   fr:'Israël',                     pt:'Israel'},                capitals:{es:'Jerusalén',           en:'Jerusalem',           fr:'Jérusalem',            pt:'Jerusalém'}},
  {code:'IN',flag:'🇮🇳',names:{es:'India',                en:'India',                    fr:'Inde',                       pt:'Índia'},                 capitals:{es:'Nueva Delhi',         en:'New Delhi',           fr:'New Delhi',            pt:'Nova Délhi'}},
  {code:'IQ',flag:'🇮🇶',names:{es:'Irak',                 en:'Iraq',                     fr:'Irak',                       pt:'Iraque'},                capitals:{es:'Bagdad',              en:'Baghdad',             fr:'Bagdad',               pt:'Bagdá'}},
  {code:'IR',flag:'🇮🇷',names:{es:'Irán',                 en:'Iran',                     fr:'Iran',                       pt:'Irã'},                   capitals:{es:'Teherán',             en:'Tehran',              fr:'Téhéran',              pt:'Teerã'}},
  {code:'JP',flag:'🇯🇵',names:{es:'Japón',                en:'Japan',                    fr:'Japon',                      pt:'Japão'},                 capitals:{es:'Tokio',               en:'Tokyo',               fr:'Tokyo',                pt:'Tóquio'}},
  {code:'JO',flag:'🇯🇴',names:{es:'Jordania',             en:'Jordan',                   fr:'Jordanie',                   pt:'Jordânia'},              capitals:{es:'Ammán',               en:'Amman',               fr:'Amman',                pt:'Amã'}},
  {code:'KG',flag:'🇰🇬',names:{es:'Kirguistán',           en:'Kyrgyzstan',               fr:'Kirghizistan',               pt:'Quirguistão'},           capitals:{es:'Biskek',              en:'Bishkek',             fr:'Bichkek',              pt:'Bisqueque'}},
  {code:'KH',flag:'🇰🇭',names:{es:'Camboya',              en:'Cambodia',                 fr:'Cambodge',                   pt:'Camboja'},               capitals:{es:'Nom Pen',             en:'Phnom Penh',          fr:'Phnom Penh',           pt:'Phnom Penh'}},
  {code:'KP',flag:'🇰🇵',names:{es:'Corea del Norte',      en:'North Korea',              fr:'Corée du Nord',              pt:'Coreia do Norte'},       capitals:{es:'Pionyang',            en:'Pyongyang',           fr:'Pyongyang',            pt:'Pyongyang'}},
  {code:'KR',flag:'🇰🇷',names:{es:'Corea del Sur',        en:'South Korea',              fr:'Corée du Sud',               pt:'Coreia do Sul'},         capitals:{es:'Seúl',                en:'Seoul',               fr:'Séoul',                pt:'Seul'}},
  {code:'KW',flag:'🇰🇼',names:{es:'Kuwait',               en:'Kuwait',                   fr:'Koweït',                     pt:'Kuwait'},                capitals:{es:'Kuwait',              en:'Kuwait City',         fr:'Koweït',               pt:'Cidade do Kuwait'}},
  {code:'KZ',flag:'🇰🇿',names:{es:'Kazajistán',           en:'Kazakhstan',               fr:'Kazakhstan',                 pt:'Cazaquistão'},           capitals:{es:'Astana',              en:'Astana',              fr:'Astana',               pt:'Astana'}},
  {code:'LA',flag:'🇱🇦',names:{es:'Laos',                 en:'Laos',                     fr:'Laos',                       pt:'Laos'},                  capitals:{es:'Vientián',            en:'Vientiane',           fr:'Vientiane',            pt:'Vientiane'}},
  {code:'LB',flag:'🇱🇧',names:{es:'Líbano',               en:'Lebanon',                  fr:'Liban',                      pt:'Líbano'},                capitals:{es:'Beirut',              en:'Beirut',              fr:'Beyrouth',             pt:'Beirute'}},
  {code:'LK',flag:'🇱🇰',names:{es:'Sri Lanka',            en:'Sri Lanka',                fr:'Sri Lanka',                  pt:'Sri Lanka'},             capitals:{es:'Colombo',             en:'Colombo',             fr:'Colombo',              pt:'Colombo'}},
  {code:'MM',flag:'🇲🇲',names:{es:'Myanmar',              en:'Myanmar',                  fr:'Myanmar',                    pt:'Myanmar'},               capitals:{es:'Naipyidó',            en:'Naypyidaw',           fr:'Naypyidaw',            pt:'Naypyidaw'}},
  {code:'MN',flag:'🇲🇳',names:{es:'Mongolia',             en:'Mongolia',                 fr:'Mongolie',                   pt:'Mongólia'},              capitals:{es:'Ulán Bator',          en:'Ulaanbaatar',         fr:'Oulan-Bator',          pt:'Ulaanbaatar'}},
  {code:'MY',flag:'🇲🇾',names:{es:'Malasia',              en:'Malaysia',                 fr:'Malaisie',                   pt:'Malásia'},               capitals:{es:'Kuala Lumpur',        en:'Kuala Lumpur',        fr:'Kuala Lumpur',         pt:'Kuala Lumpur'}},
  {code:'NP',flag:'🇳🇵',names:{es:'Nepal',                en:'Nepal',                    fr:'Népal',                      pt:'Nepal'},                 capitals:{es:'Katmandú',            en:'Kathmandu',           fr:'Katmandou',            pt:'Catmandu'}},
  {code:'OM',flag:'🇴🇲',names:{es:'Omán',                 en:'Oman',                     fr:'Oman',                       pt:'Omã'},                   capitals:{es:'Mascate',             en:'Muscat',              fr:'Mascate',              pt:'Mascate'}},
  {code:'PH',flag:'🇵🇭',names:{es:'Filipinas',            en:'Philippines',              fr:'Philippines',                pt:'Filipinas'},             capitals:{es:'Manila',              en:'Manila',              fr:'Manille',              pt:'Manila'}},
  {code:'PK',flag:'🇵🇰',names:{es:'Pakistán',             en:'Pakistan',                 fr:'Pakistan',                   pt:'Paquistão'},             capitals:{es:'Islamabad',           en:'Islamabad',           fr:'Islamabad',            pt:'Islamabad'}},
  {code:'PS',flag:'🇵🇸',names:{es:'Palestina',            en:'Palestine',                fr:'Palestine',                  pt:'Palestina'},             capitals:{es:'Ramala',              en:'Ramallah',            fr:'Ramallah',             pt:'Ramallah'}},
  {code:'QA',flag:'🇶🇦',names:{es:'Catar',                en:'Qatar',                    fr:'Qatar',                      pt:'Catar'},                 capitals:{es:'Doha',                en:'Doha',                fr:'Doha',                 pt:'Doha'}},
  {code:'SA',flag:'🇸🇦',names:{es:'Arabia Saudita',       en:'Saudi Arabia',             fr:'Arabie saoudite',            pt:'Arábia Saudita'},        capitals:{es:'Riad',                en:'Riyadh',              fr:'Riyad',                pt:'Riade'}},
  {code:'SG',flag:'🇸🇬',names:{es:'Singapur',             en:'Singapore',                fr:'Singapour',                  pt:'Singapura'},             capitals:{es:'Singapur',            en:'Singapore',           fr:'Singapour',            pt:'Singapura'}},
  {code:'SY',flag:'🇸🇾',names:{es:'Siria',                en:'Syria',                    fr:'Syrie',                      pt:'Síria'},                 capitals:{es:'Damasco',             en:'Damascus',            fr:'Damas',                pt:'Damasco'}},
  {code:'TH',flag:'🇹🇭',names:{es:'Tailandia',            en:'Thailand',                 fr:'Thaïlande',                  pt:'Tailândia'},             capitals:{es:'Bangkok',             en:'Bangkok',             fr:'Bangkok',              pt:'Bangcoque'}},
  {code:'TJ',flag:'🇹🇯',names:{es:'Tayikistán',           en:'Tajikistan',               fr:'Tadjikistan',                pt:'Tajiquistão'},           capitals:{es:'Dusambé',             en:'Dushanbe',            fr:'Douchanbé',            pt:'Duchambe'}},
  {code:'TL',flag:'🇹🇱',names:{es:'Timor Oriental',       en:'Timor-Leste',              fr:'Timor oriental',             pt:'Timor-Leste'},           capitals:{es:'Dili',                en:'Dili',                fr:'Dili',                 pt:'Díli'}},
  {code:'TM',flag:'🇹🇲',names:{es:'Turkmenistán',         en:'Turkmenistan',             fr:'Turkménistan',               pt:'Turcomenistão'},         capitals:{es:'Asjabad',             en:'Ashgabat',            fr:'Achgabat',             pt:'Asgabate'}},
  {code:'TW',flag:'🇹🇼',names:{es:'Taiwán',               en:'Taiwan',                   fr:'Taïwan',                     pt:'Taiwan'},                capitals:{es:'Taipéi',              en:'Taipei',              fr:'Taipei',               pt:'Taipé'}},
  {code:'UZ',flag:'🇺🇿',names:{es:'Uzbekistán',           en:'Uzbekistan',               fr:'Ouzbékistan',                pt:'Uzbequistão'},           capitals:{es:'Taskent',             en:'Tashkent',            fr:'Tachkent',             pt:'Tashkent'}},
  {code:'VN',flag:'🇻🇳',names:{es:'Vietnam',              en:'Vietnam',                  fr:'Viêt Nam',                   pt:'Vietnã'},                capitals:{es:'Hanói',               en:'Hanoi',               fr:'Hanoï',                pt:'Hanói'}},
  {code:'YE',flag:'🇾🇪',names:{es:'Yemen',                en:'Yemen',                    fr:'Yémen',                      pt:'Iêmen'},                 capitals:{es:'Saná',                en:'Sanaa',               fr:'Sanaa',                pt:'Sanaa'}},

  /* ── África ──────────────────────────────────────── */
  {code:'AO',flag:'🇦🇴',names:{es:'Angola',               en:'Angola',                   fr:'Angola',                     pt:'Angola'},                capitals:{es:'Luanda',              en:'Luanda',              fr:'Luanda',               pt:'Luanda'}},
  {code:'BF',flag:'🇧🇫',names:{es:'Burkina Faso',         en:'Burkina Faso',             fr:'Burkina Faso',               pt:'Burkina Faso'},          capitals:{es:'Uagadugú',            en:'Ouagadougou',         fr:'Ouagadougou',          pt:'Ouagadougou'}},
  {code:'BI',flag:'🇧🇮',names:{es:'Burundi',              en:'Burundi',                  fr:'Burundi',                    pt:'Burundi'},               capitals:{es:'Gitega',              en:'Gitega',              fr:'Gitega',               pt:'Gitega'}},
  {code:'BJ',flag:'🇧🇯',names:{es:'Benín',                en:'Benin',                    fr:'Bénin',                      pt:'Benim'},                 capitals:{es:'Porto Novo',          en:'Porto-Novo',          fr:'Porto-Novo',           pt:'Porto Novo'}},
  {code:'BW',flag:'🇧🇼',names:{es:'Botsuana',             en:'Botswana',                 fr:'Botswana',                   pt:'Botsuana'},              capitals:{es:'Gaborone',            en:'Gaborone',            fr:'Gaborone',             pt:'Gaborone'}},
  {code:'CD',flag:'🇨🇩',names:{es:'R. D. del Congo',      en:'DR Congo',                 fr:'Congo (RDC)',                 pt:'Congo (RDC)'},           capitals:{es:'Kinshasa',            en:'Kinshasa',            fr:'Kinshasa',             pt:'Kinshasa'}},
  {code:'CF',flag:'🇨🇫',names:{es:'R. Centroafricana',    en:'Central African Republic', fr:'République centrafricaine',  pt:'Rep. Centro-Africana'},  capitals:{es:'Bangui',              en:'Bangui',              fr:'Bangui',               pt:'Bangui'}},
  {code:'CG',flag:'🇨🇬',names:{es:'Rep. del Congo',       en:'Republic of Congo',        fr:'Congo (République)',          pt:'Congo (República)'},     capitals:{es:'Brazzaville',         en:'Brazzaville',         fr:'Brazzaville',          pt:'Brazzaville'}},
  {code:'CI',flag:'🇨🇮',names:{es:'Costa de Marfil',      en:'Ivory Coast',              fr:'Côte d\'Ivoire',             pt:'Costa do Marfim'},       capitals:{es:'Yamusukro',           en:'Yamoussoukro',        fr:'Yamoussoukro',         pt:'Yamoussoukro'}},
  {code:'CM',flag:'🇨🇲',names:{es:'Camerún',              en:'Cameroon',                 fr:'Cameroun',                   pt:'Camarões'},              capitals:{es:'Yaundé',              en:'Yaoundé',             fr:'Yaoundé',              pt:'Yaoundé'}},
  {code:'CV',flag:'🇨🇻',names:{es:'Cabo Verde',           en:'Cape Verde',               fr:'Cap-Vert',                   pt:'Cabo Verde'},            capitals:{es:'Praia',               en:'Praia',               fr:'Praia',                pt:'Praia'}},
  {code:'DJ',flag:'🇩🇯',names:{es:'Yibuti',               en:'Djibouti',                 fr:'Djibouti',                   pt:'Djibuti'},               capitals:{es:'Yibuti',              en:'Djibouti',            fr:'Djibouti',             pt:'Djibuti'}},
  {code:'DZ',flag:'🇩🇿',names:{es:'Argelia',              en:'Algeria',                  fr:'Algérie',                    pt:'Argélia'},               capitals:{es:'Argel',               en:'Algiers',             fr:'Alger',                pt:'Argel'}},
  {code:'EG',flag:'🇪🇬',names:{es:'Egipto',               en:'Egypt',                    fr:'Égypte',                     pt:'Egito'},                 capitals:{es:'El Cairo',            en:'Cairo',               fr:'Le Caire',             pt:'Cairo'}},
  {code:'ER',flag:'🇪🇷',names:{es:'Eritrea',              en:'Eritrea',                  fr:'Érythrée',                   pt:'Eritreia'},              capitals:{es:'Asmara',              en:'Asmara',              fr:'Asmara',               pt:'Asmara'}},
  {code:'ET',flag:'🇪🇹',names:{es:'Etiopía',              en:'Ethiopia',                 fr:'Éthiopie',                   pt:'Etiópia'},               capitals:{es:'Adís Abeba',          en:'Addis Ababa',         fr:'Addis-Abeba',          pt:'Adis Abeba'}},
  {code:'GA',flag:'🇬🇦',names:{es:'Gabón',                en:'Gabon',                    fr:'Gabon',                      pt:'Gabão'},                 capitals:{es:'Libreville',          en:'Libreville',          fr:'Libreville',           pt:'Libreville'}},
  {code:'GH',flag:'🇬🇭',names:{es:'Ghana',                en:'Ghana',                    fr:'Ghana',                      pt:'Gana'},                  capitals:{es:'Acra',                en:'Accra',               fr:'Accra',                pt:'Acra'}},
  {code:'GM',flag:'🇬🇲',names:{es:'Gambia',               en:'Gambia',                   fr:'Gambie',                     pt:'Gâmbia'},                capitals:{es:'Banjul',              en:'Banjul',              fr:'Banjul',               pt:'Banjul'}},
  {code:'GN',flag:'🇬🇳',names:{es:'Guinea',               en:'Guinea',                   fr:'Guinée',                     pt:'Guiné'},                 capitals:{es:'Conakri',             en:'Conakry',             fr:'Conakry',              pt:'Conacri'}},
  {code:'GQ',flag:'🇬🇶',names:{es:'Guinea Ecuatorial',    en:'Equatorial Guinea',        fr:'Guinée équatoriale',         pt:'Guiné Equatorial'},      capitals:{es:'Malabo',              en:'Malabo',              fr:'Malabo',               pt:'Malabo'}},
  {code:'GW',flag:'🇬🇼',names:{es:'Guinea-Bisáu',         en:'Guinea-Bissau',            fr:'Guinée-Bissau',              pt:'Guiné-Bissau'},          capitals:{es:'Bisáu',               en:'Bissau',              fr:'Bissau',               pt:'Bissau'}},
  {code:'KE',flag:'🇰🇪',names:{es:'Kenia',                en:'Kenya',                    fr:'Kenya',                      pt:'Quênia'},                capitals:{es:'Nairobi',             en:'Nairobi',             fr:'Nairobi',              pt:'Nairóbi'}},
  {code:'KM',flag:'🇰🇲',names:{es:'Comoras',              en:'Comoros',                  fr:'Comores',                    pt:'Comores'},               capitals:{es:'Moroni',              en:'Moroni',              fr:'Moroni',               pt:'Moroni'}},
  {code:'LR',flag:'🇱🇷',names:{es:'Liberia',              en:'Liberia',                  fr:'Libéria',                    pt:'Libéria'},               capitals:{es:'Monrovia',            en:'Monrovia',            fr:'Monrovia',             pt:'Monróvia'}},
  {code:'LS',flag:'🇱🇸',names:{es:'Lesoto',               en:'Lesotho',                  fr:'Lesotho',                    pt:'Lesoto'},                capitals:{es:'Maseru',              en:'Maseru',              fr:'Maseru',               pt:'Maseru'}},
  {code:'LY',flag:'🇱🇾',names:{es:'Libia',                en:'Libya',                    fr:'Libye',                      pt:'Líbia'},                 capitals:{es:'Trípoli',             en:'Tripoli',             fr:'Tripoli',              pt:'Trípoli'}},
  {code:'MA',flag:'🇲🇦',names:{es:'Marruecos',            en:'Morocco',                  fr:'Maroc',                      pt:'Marrocos'},              capitals:{es:'Rabat',               en:'Rabat',               fr:'Rabat',                pt:'Rabat'}},
  {code:'MG',flag:'🇲🇬',names:{es:'Madagascar',           en:'Madagascar',               fr:'Madagascar',                 pt:'Madagáscar'},            capitals:{es:'Antananarivo',        en:'Antananarivo',        fr:'Antananarivo',         pt:'Antananarivo'}},
  {code:'ML',flag:'🇲🇱',names:{es:'Mali',                 en:'Mali',                     fr:'Mali',                       pt:'Mali'},                  capitals:{es:'Bamako',              en:'Bamako',              fr:'Bamako',               pt:'Bamako'}},
  {code:'MR',flag:'🇲🇷',names:{es:'Mauritania',           en:'Mauritania',               fr:'Mauritanie',                 pt:'Mauritânia'},            capitals:{es:'Nuakchot',            en:'Nouakchott',          fr:'Nouakchott',           pt:'Nuaquechute'}},
  {code:'MU',flag:'🇲🇺',names:{es:'Mauricio',             en:'Mauritius',                fr:'Maurice',                    pt:'Maurício'},              capitals:{es:'Port Louis',          en:'Port Louis',          fr:'Port Louis',           pt:'Port Louis'}},
  {code:'MW',flag:'🇲🇼',names:{es:'Malaui',               en:'Malawi',                   fr:'Malawi',                     pt:'Malawi'},                capitals:{es:'Lilongüe',            en:'Lilongwe',            fr:'Lilongwe',             pt:'Lilongué'}},
  {code:'MZ',flag:'🇲🇿',names:{es:'Mozambique',           en:'Mozambique',               fr:'Mozambique',                 pt:'Moçambique'},            capitals:{es:'Maputo',              en:'Maputo',              fr:'Maputo',               pt:'Maputo'}},
  {code:'NA',flag:'🇳🇦',names:{es:'Namibia',              en:'Namibia',                  fr:'Namibie',                    pt:'Namíbia'},               capitals:{es:'Windhoek',            en:'Windhoek',            fr:'Windhoek',             pt:'Windhoek'}},
  {code:'NE',flag:'🇳🇪',names:{es:'Níger',                en:'Niger',                    fr:'Niger',                      pt:'Níger'},                 capitals:{es:'Niamey',              en:'Niamey',              fr:'Niamey',               pt:'Niamei'}},
  {code:'NG',flag:'🇳🇬',names:{es:'Nigeria',              en:'Nigeria',                  fr:'Nigeria',                    pt:'Nigéria'},               capitals:{es:'Abuja',               en:'Abuja',               fr:'Abuja',                pt:'Abuja'}},
  {code:'RW',flag:'🇷🇼',names:{es:'Ruanda',               en:'Rwanda',                   fr:'Rwanda',                     pt:'Ruanda'},                capitals:{es:'Kigali',              en:'Kigali',              fr:'Kigali',               pt:'Kigali'}},
  {code:'SC',flag:'🇸🇨',names:{es:'Seychelles',           en:'Seychelles',               fr:'Seychelles',                 pt:'Seicheles'},             capitals:{es:'Victoria',            en:'Victoria',            fr:'Victoria',             pt:'Victoria'}},
  {code:'SD',flag:'🇸🇩',names:{es:'Sudán',                en:'Sudan',                    fr:'Soudan',                     pt:'Sudão'},                 capitals:{es:'Jartum',              en:'Khartoum',            fr:'Khartoum',             pt:'Cartum'}},
  {code:'SL',flag:'🇸🇱',names:{es:'Sierra Leona',         en:'Sierra Leone',             fr:'Sierra Leone',               pt:'Serra Leoa'},            capitals:{es:'Freetown',            en:'Freetown',            fr:'Freetown',             pt:'Freetown'}},
  {code:'SN',flag:'🇸🇳',names:{es:'Senegal',              en:'Senegal',                  fr:'Sénégal',                    pt:'Senegal'},               capitals:{es:'Dakar',               en:'Dakar',               fr:'Dakar',                pt:'Dacar'}},
  {code:'SO',flag:'🇸🇴',names:{es:'Somalia',              en:'Somalia',                  fr:'Somalie',                    pt:'Somália'},               capitals:{es:'Mogadiscio',          en:'Mogadishu',           fr:'Mogadiscio',           pt:'Mogadíscio'}},
  {code:'SS',flag:'🇸🇸',names:{es:'Sudán del Sur',        en:'South Sudan',              fr:'Soudan du Sud',              pt:'Sudão do Sul'},          capitals:{es:'Yuba',                en:'Juba',                fr:'Djouba',               pt:'Juba'}},
  {code:'ST',flag:'🇸🇹',names:{es:'S. Tomé y Príncipe',   en:'São Tomé and Príncipe',    fr:'Sao Tomé-et-Principe',       pt:'São Tomé e Príncipe'},   capitals:{es:'Santo Tomé',          en:'São Tomé',            fr:'São Tomé',             pt:'São Tomé'}},
  {code:'SZ',flag:'🇸🇿',names:{es:'Suazilandia',          en:'Eswatini',                 fr:'Eswatini',                   pt:'Essuatíni'},             capitals:{es:'Mbabane',             en:'Mbabane',             fr:'Mbabane',              pt:'Mbabane'}},
  {code:'TD',flag:'🇹🇩',names:{es:'Chad',                 en:'Chad',                     fr:'Tchad',                      pt:'Chade'},                 capitals:{es:'Yamena',              en:'N\'Djamena',          fr:'N\'Djamena',           pt:'N\'Djamena'}},
  {code:'TG',flag:'🇹🇬',names:{es:'Togo',                 en:'Togo',                     fr:'Togo',                       pt:'Togo'},                  capitals:{es:'Lomé',                en:'Lomé',                fr:'Lomé',                 pt:'Lomé'}},
  {code:'TN',flag:'🇹🇳',names:{es:'Túnez',                en:'Tunisia',                  fr:'Tunisie',                    pt:'Tunísia'},               capitals:{es:'Túnez',               en:'Tunis',               fr:'Tunis',                pt:'Túnis'}},
  {code:'TZ',flag:'🇹🇿',names:{es:'Tanzania',             en:'Tanzania',                 fr:'Tanzanie',                   pt:'Tanzânia'},              capitals:{es:'Dodoma',              en:'Dodoma',              fr:'Dodoma',               pt:'Dodoma'}},
  {code:'UG',flag:'🇺🇬',names:{es:'Uganda',               en:'Uganda',                   fr:'Ouganda',                    pt:'Uganda'},                capitals:{es:'Kampala',             en:'Kampala',             fr:'Kampala',              pt:'Kampala'}},
  {code:'ZA',flag:'🇿🇦',names:{es:'Sudáfrica',            en:'South Africa',             fr:'Afrique du Sud',             pt:'África do Sul'},         capitals:{es:'Pretoria',            en:'Pretoria',            fr:'Pretoria',             pt:'Pretória'}},
  {code:'ZM',flag:'🇿🇲',names:{es:'Zambia',               en:'Zambia',                   fr:'Zambie',                     pt:'Zâmbia'},                capitals:{es:'Lusaka',              en:'Lusaka',              fr:'Lusaka',               pt:'Lusaka'}},
  {code:'ZW',flag:'🇿🇼',names:{es:'Zimbabue',             en:'Zimbabwe',                 fr:'Zimbabwe',                   pt:'Zimbábue'},              capitals:{es:'Harare',              en:'Harare',              fr:'Harare',               pt:'Harare'}},

  /* ── Oceanía ─────────────────────────────────────── */
  {code:'AU',flag:'🇦🇺',names:{es:'Australia',            en:'Australia',                fr:'Australie',                  pt:'Austrália'},             capitals:{es:'Canberra',            en:'Canberra',            fr:'Canberra',             pt:'Camberra'}},
  {code:'FJ',flag:'🇫🇯',names:{es:'Fiyi',                 en:'Fiji',                     fr:'Fidji',                      pt:'Fiji'},                  capitals:{es:'Suva',                en:'Suva',                fr:'Suva',                 pt:'Suva'}},
  {code:'FM',flag:'🇫🇲',names:{es:'Micronesia',           en:'Micronesia',               fr:'Micronésie',                 pt:'Micronésia'},            capitals:{es:'Palikir',             en:'Palikir',             fr:'Palikir',              pt:'Palikir'}},
  {code:'KI',flag:'🇰🇮',names:{es:'Kiribati',             en:'Kiribati',                 fr:'Kiribati',                   pt:'Kiribati'},              capitals:{es:'Tarawa del Sur',      en:'South Tarawa',        fr:'Tarawa-Sud',           pt:'Tarawa Sul'}},
  {code:'MH',flag:'🇲🇭',names:{es:'Islas Marshall',       en:'Marshall Islands',         fr:'Îles Marshall',              pt:'Ilhas Marshall'},        capitals:{es:'Majuro',              en:'Majuro',              fr:'Majuro',               pt:'Majuro'}},
  {code:'NR',flag:'🇳🇷',names:{es:'Nauru',                en:'Nauru',                    fr:'Nauru',                      pt:'Nauru'},                 capitals:{es:'Yaren',               en:'Yaren',               fr:'Yaren',                pt:'Yaren'}},
  {code:'NZ',flag:'🇳🇿',names:{es:'Nueva Zelanda',        en:'New Zealand',              fr:'Nouvelle-Zélande',           pt:'Nova Zelândia'},         capitals:{es:'Wellington',          en:'Wellington',          fr:'Wellington',           pt:'Wellington'}},
  {code:'PG',flag:'🇵🇬',names:{es:'Papúa Nueva Guinea',   en:'Papua New Guinea',         fr:'Papouasie-Nouvelle-Guinée',  pt:'Papua Nova Guiné'},      capitals:{es:'Port Moresby',        en:'Port Moresby',        fr:'Port Moresby',         pt:'Port Moresby'}},
  {code:'PW',flag:'🇵🇼',names:{es:'Palaos',               en:'Palau',                    fr:'Palaos',                     pt:'Palau'},                 capitals:{es:'Ngerulmud',           en:'Ngerulmud',           fr:'Ngerulmud',            pt:'Ngerulmud'}},
  {code:'SB',flag:'🇸🇧',names:{es:'Islas Salomón',        en:'Solomon Islands',          fr:'Îles Salomon',               pt:'Ilhas Salomão'},         capitals:{es:'Honiara',             en:'Honiara',             fr:'Honiara',              pt:'Honiara'}},
  {code:'TO',flag:'🇹🇴',names:{es:'Tonga',                en:'Tonga',                    fr:'Tonga',                      pt:'Tonga'},                 capitals:{es:'Nukualofa',           en:'Nuku\'alofa',         fr:'Nuku\'alofa',          pt:'Nuku\'alofa'}},
  {code:'TV',flag:'🇹🇻',names:{es:'Tuvalu',               en:'Tuvalu',                   fr:'Tuvalu',                     pt:'Tuvalu'},                capitals:{es:'Funafuti',            en:'Funafuti',            fr:'Funafuti',             pt:'Funafuti'}},
  {code:'VU',flag:'🇻🇺',names:{es:'Vanuatu',              en:'Vanuatu',                  fr:'Vanuatu',                    pt:'Vanuatu'},               capitals:{es:'Port Vila',           en:'Port Vila',           fr:'Port-Vila',            pt:'Port Vila'}},
  {code:'WS',flag:'🇼🇸',names:{es:'Samoa',                en:'Samoa',                    fr:'Samoa',                      pt:'Samoa'},                 capitals:{es:'Apia',                en:'Apia',                fr:'Apia',                 pt:'Apia'}},
];

function getDistractors(excludeCode, n) {
  var pool=COUNTRIES.filter(function(c){return c.code!==excludeCode;});
  var result=[];
  for (var i=0;i<Math.min(n,pool.length);i++) {
    var idx=Math.floor(Math.random()*pool.length);
    result.push(pool.splice(idx,1)[0]);
  }
  return result;
}

/* ── Mapa de continentes ─────────────────────────────────── */
var CONTINENT_MAP = {
  eu: ['AD','AL','AT','BA','BE','BG','BY','CH','CY','CZ','DE','DK','EE','ES','FI','FR','GB','GR',
       'HR','HU','IE','IS','IT','LI','LT','LU','LV','MC','MD','ME','MK','MT','NL','NO','PL','PT',
       'RO','RS','RU','SE','SI','SK','SM','TR','UA','VA','XK'],
  am: ['AG','BB','BZ','CA','CR','CU','DM','DO','GD','GT','HN','HT','KN','LC','JM','MX','NI','PA',
       'SV','TT','VC','US','AR','BO','BR','CL','CO','EC','GY','PE','PY','SR','UY','VE'],
  as: ['AE','AF','AM','AZ','BD','BH','BN','BT','CN','GE','ID','IL','IN','IQ','IR','JP','JO','KG',
       'KH','KP','KR','KW','KZ','LA','LB','LK','MM','MN','MY','NP','OM','PH','PK','PS','QA','SA',
       'SG','SY','TH','TJ','TL','TM','TW','UZ','VN','YE'],
  af: ['AO','BF','BI','BJ','BW','CD','CF','CG','CI','CM','CV','DJ','DZ','EG','ER','ET','GA','GH',
       'GM','GN','GQ','GW','KE','KM','LR','LS','LY','MA','MG','ML','MR','MU','MW','MZ','NA','NE',
       'NG','RW','SC','SD','SL','SN','SO','SS','ST','SZ','TD','TG','TN','TZ','UG','ZA','ZM','ZW'],
  oc: ['AU','FJ','FM','KI','MH','NR','NZ','PG','PW','SB','TO','TV','VU','WS']
};

function getCountriesByContinent(continent) {
  if (!continent || continent === 'all') return COUNTRIES.slice();
  var codes = CONTINENT_MAP[continent] || [];
  return COUNTRIES.filter(function(c){ return codes.indexOf(c.code) !== -1; });
}

/**
 * Dado un código de país ISO-2 (ej: "ES", "MX"), devuelve la clave
 * del continente en CONTINENT_MAP ("eu", "am", "as", "af", "oc")
 * o null si no se encuentra.
 *
 * Case-insensitive: convierte el input a mayúsculas antes de buscar.
 *
 * @param {string} countryCode  Código ISO-2 del país
 * @returns {string|null}
 */
function getContinentForCountry(countryCode) {
  if (!countryCode || typeof countryCode !== 'string') return null;
  var code = countryCode.toUpperCase();
  var keys = Object.keys(CONTINENT_MAP);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (CONTINENT_MAP[key].indexOf(code) !== -1) {
      return key;
    }
  }
  return null;
}

/* ── O(1) lookup map: code → country object ────────────────────── */
var COUNTRIES_BY_CODE = {};
(function() {
  for (var i = 0; i < COUNTRIES.length; i++) {
    COUNTRIES_BY_CODE[COUNTRIES[i].code] = COUNTRIES[i];
  }
})();
