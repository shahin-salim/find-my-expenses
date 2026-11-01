import type { BankDefinition } from './types';

/**
 * Section 2.3: "Most banks need nothing written for them." Everything here is
 * a sender fragment and a display name; the shared steps do the reading.
 *
 * A bank moves out of this list into a file of its own the moment one of its
 * formats needs a step replaced.
 */
const GENERIC: Array<[key: string, name: string, fragments: string[]]> = [
  ['kotak', 'Kotak Mahindra Bank', ['KOTAKB', 'KOTAKM', 'KMBANK']],
  ['pnb', 'Punjab National Bank', ['PNBSMS', 'PNBBNK', 'PUNBNK']],
  ['bob', 'Bank of Baroda', ['BOBSMS', 'BOBTXN', 'BOBIBN']],
  ['canara', 'Canara Bank', ['CANBNK', 'CANARA']],
  ['union', 'Union Bank of India', ['UNIONB', 'UNIONBK']],
  ['yes', 'YES Bank', ['YESBNK', 'YESBK']],
  ['indusind', 'IndusInd Bank', ['INDUSB', 'INDUSIND']],
  ['federal', 'Federal Bank', ['FEDBNK', 'FEDERAL']],
  ['rbl', 'RBL Bank', ['RBLBNK', 'RBLBK']],
  ['aubank', 'AU Small Finance Bank', ['AUBANK', 'AUSFBL']],
  ['boi', 'Bank of India', ['BOIIND', 'BOINET']],
  ['iob', 'Indian Overseas Bank', ['IOBCHN', 'IOBANK']],
  ['indianbank', 'Indian Bank', ['INDBNK', 'INDIANBK']],
  ['centralbank', 'Central Bank of India', ['CENTBK', 'CBIIND']],
  ['uco', 'UCO Bank', ['UCOBNK']],
  ['idbi', 'IDBI Bank', ['IDBIBK', 'IDBIBNK']],
  ['karnataka', 'Karnataka Bank', ['KTKBNK', 'KARBNK']],
  ['sib', 'South Indian Bank', ['SIBSMS', 'SIBLTD']],
  ['csb', 'CSB Bank', ['CSBBNK']],
  ['dbs', 'DBS Bank', ['DBSBNK', 'DBSSMS']],
  ['hsbc', 'HSBC', ['HSBCIN', 'HSBCBK']],
  ['citi', 'Citibank', ['CITIBK', 'CITIIN']],
  ['amex', 'American Express', ['AMEXIN', 'AMEX']],
  ['bandhan', 'Bandhan Bank', ['BANDAN', 'BDNBNK']],
  ['ujjivan', 'Ujjivan Small Finance Bank', ['UJVNBK', 'UJJIVN']],
  ['equitas', 'Equitas Small Finance Bank', ['EQUITS', 'EQTSBK']],
  ['jupiter', 'Jupiter', ['JUPITR']],
  ['paytmbank', 'Paytm Payments Bank', ['PYTMPB', 'PAYTMB']],
  ['airtelbank', 'Airtel Payments Bank', ['AIRBNK', 'ATLPBK']],
  ['fino', 'Fino Payments Bank', ['FINOPB', 'FINOBK']],
  ['karurvysya', 'Karur Vysya Bank', ['KVBANK', 'KVBSMS']],
  ['tmb', 'Tamilnad Mercantile Bank', ['TMBANK', 'TMBLTD']],
  ['dcb', 'DCB Bank', ['DCBBNK']],
  ['jkbank', 'J&K Bank', ['JKBANK']],
  ['punjabsind', 'Punjab & Sind Bank', ['PSBANK', 'PSBSMS']],
  ['maharashtra', 'Bank of Maharashtra', ['MAHABK', 'BOMSMS']],
];

export const GENERIC_BANKS: BankDefinition[] = GENERIC.map(
  ([bankKey, bankName, senderFragments]) => ({
    id: bankKey,
    bankKey,
    bankName,
    senderFragments,
  }),
);
