import { categoryKeyForMerchantName, KEYWORD_COUNT, RULE_COUNT } from '../categorize';

describe('automatic categorization', () => {
  test('ships the full rule set from section 5.4', () => {
    expect(RULE_COUNT).toBe(237);
    expect(KEYWORD_COUNT).toBe(78);
  });

  test('matches a well known brand', () => {
    expect(categoryKeyForMerchantName('SWIGGY')).toBe('food');
    expect(categoryKeyForMerchantName('Zepto')).toBe('groceries');
    expect(categoryKeyForMerchantName('REDBUS')).toBe('transport');
    expect(categoryKeyForMerchantName('BESCOM')).toBe('bills');
  });

  test('longer names are checked before shorter ones', () => {
    // The example the spec gives, both directions.
    expect(categoryKeyForMerchantName('SWIGGY INSTAMART')).toBe('groceries');
    expect(categoryKeyForMerchantName('SWIGGY')).toBe('food');
    // The same trap, three ways, around one brand.
    expect(categoryKeyForMerchantName('AMAZON')).toBe('shopping');
    expect(categoryKeyForMerchantName('AMAZON FRESH')).toBe('groceries');
    expect(categoryKeyForMerchantName('AMAZON PRIME')).toBe('bills');
  });

  test('strips the trailing words section 5.2 names', () => {
    expect(categoryKeyForMerchantName('Swiggy India Private Limited')).toBe('food');
    expect(categoryKeyForMerchantName('ZOMATO LTD')).toBe('food');
    expect(categoryKeyForMerchantName('Bundl Technologies')).toBeNull();
  });

  test('does not match a brand name inside a longer word', () => {
    // `ola` is a rule; `Chocolate House` must not become Transport.
    expect(categoryKeyForMerchantName('Chocolate House')).toBeNull();
    expect(categoryKeyForMerchantName('OLA')).toBe('transport');
  });

  test('a person is left for the user', () => {
    // A tea stall used to be left here too. It is now read by the keyword
    // pass below, which is the point of that pass: the shop at the end of
    // the road is never going to be in a rules file, and it says what it is.
    expect(categoryKeyForMerchantName('Ananya R')).toBeNull();
    expect(categoryKeyForMerchantName(null)).toBeNull();
    // Section 5.2: a UPI ID in place of a name cannot be categorized.
    expect(categoryKeyForMerchantName('paytmqr2810050501@paytm')).toBeNull();
  });
});

describe('the categories added after reading a year of real payments', () => {
  it('files a local chemist under health, not nowhere', () => {
    expect(categoryKeyForMerchantName('MAR BASELIOS MEDICAL')).toBe('health');
    expect(categoryKeyForMerchantName('DEEPTHI MEDICALS')).toBe('health');
    expect(categoryKeyForMerchantName('METROPOLIS HEALTHCARE')).toBe('health');
    expect(categoryKeyForMerchantName('APOLLO PHARMACY')).toBe('health');
  });

  it('files a neighbourhood pump under fuel, not nowhere', () => {
    expect(categoryKeyForMerchantName('Diya fuels')).toBe('fuel');
    expect(categoryKeyForMerchantName('PALCO FUELS')).toBe('fuel');
    expect(categoryKeyForMerchantName('NACHIYAAR FUELS')).toBe('fuel');
    // The national brands move across with them.
    expect(categoryKeyForMerchantName('Indian Oil')).toBe('fuel');
  });

  it('files a premium as insurance rather than as a transfer', () => {
    expect(categoryKeyForMerchantName('CARE HEALTH INSURANCE')).toBe('insurance');
    expect(categoryKeyForMerchantName('HDFC Life')).toBe('insurance');
  });

  it('does not read a metro station as the insurer', () => {
    // `LIC` alone matched `LIC Metro Station`, a Chennai stop, and filed a
    // metro fare as a fixed-cost transfer.
    expect(categoryKeyForMerchantName('Lic Metro Station')).not.toBe('insurance');
    expect(categoryKeyForMerchantName('LIC of India')).toBe('insurance');
  });

  it('does not read a hotel as a laboratory', () => {
    // A bare `lab` rule would have matched both of these.
    expect(categoryKeyForMerchantName('Malabar Hotel')).not.toBe('health');
    expect(categoryKeyForMerchantName('Labham Shoppy')).not.toBe('health');
  });

  it('keeps the longest match winning', () => {
    // `Care Health` is insurance; `Health Care` is a clinic. Both exist.
    expect(categoryKeyForMerchantName('Care Health Insurance')).toBe('insurance');
    expect(categoryKeyForMerchantName('Shell')).toBe('fuel');
  });
});

describe('the categories named after the first release', () => {
  it('reads an honorific as a person', () => {
    expect(categoryKeyForMerchantName('Mr Peddinti Ramesh')).toBe('people');
    expect(categoryKeyForMerchantName('MRS ANJALI V')).toBe('people');
    expect(categoryKeyForMerchantName('MS LALITHA')).toBe('people');
  });

  it('does not read a restaurant as a person', () => {
    // `Mr Chef` is longer than `Mr`, and the longest rule wins.
    expect(categoryKeyForMerchantName('MR CHEF MALABAR HOTEL')).toBe('food');
  });

  it('leaves the shop honorifics out of it', () => {
    // `Sri` and `Shri` open as many shop names as personal ones, so neither
    // is a rule and these fall through to the user.
    expect(categoryKeyForMerchantName('SRI NAVASAKTHI BALAN')).toBeNull();
  });

  it('files a broker as an investment, not a transfer', () => {
    expect(categoryKeyForMerchantName('Zerodha')).toBe('investment');
    expect(categoryKeyForMerchantName('Groww')).toBe('investment');
  });

  it('files a cinema as entertainment, not as other', () => {
    expect(categoryKeyForMerchantName('PVR')).toBe('entertainment');
    expect(categoryKeyForMerchantName('BookMyShow')).toBe('entertainment');
    expect(categoryKeyForMerchantName('Sathyam Cinemas')).toBe('entertainment');
  });
});

/**
 * The second pass, added after reading a year of real payments.
 *
 * Nine payments in ten went to a merchant no rule named, and most of those
 * merchants had said what they were in their own name. Every name in these
 * tests is one that actually turned up, truncation and spelling included.
 */
describe('a shop that says what it is', () => {
  it('reads the trade in the name', () => {
    expect(categoryKeyForMerchantName('BOSSA NOVA CAFE')).toBe('food');
    expect(categoryKeyForMerchantName('ANBU MESS')).toBe('food');
    expect(categoryKeyForMerchantName('AMSON BAKERY')).toBe('food');
    expect(categoryKeyForMerchantName('KANNUR KITCHEN')).toBe('food');
    expect(categoryKeyForMerchantName('SIVA PARVATHI STORE')).toBe('groceries');
    expect(categoryKeyForMerchantName('K P MART')).toBe('groceries');
    expect(categoryKeyForMerchantName('DEEPTHI MEDICALS')).toBe('health');
    expect(categoryKeyForMerchantName('BABU TEXTILES')).toBe('shopping');
  });

  it('reads the two spellings of the same dish', () => {
    expect(categoryKeyForMerchantName('K S BIRIYANI KADAI')).toBe('food');
    expect(categoryKeyForMerchantName('SS HYDERABAD BIRYANI')).toBe('food');
  });

  it('reads a trade named in the local word for it', () => {
    // Chaya is tea and a cool bar sells juice. Neither is a brand, and both
    // are on half the streets in Kerala and Tamil Nadu.
    expect(categoryKeyForMerchantName('RK CHAYA PEEDIKA')).toBe('food');
    expect(categoryKeyForMerchantName('Amman Cool Bar')).toBe('food');
    expect(categoryKeyForMerchantName('motherland Coolbar')).toBe('food');
    expect(categoryKeyForMerchantName('ALANKAR TEA STALL')).toBe('food');
  });

  it('reads a name the bank cut short', () => {
    // The sender truncates at twenty characters, so the word that says what
    // the shop is arrives with its tail missing.
    expect(categoryKeyForMerchantName('NISARGA GARDEN RESTA')).toBe('food');
    expect(categoryKeyForMerchantName('SANTHIYA RESTAU')).toBe('food');
    expect(categoryKeyForMerchantName('MR CHEF MALABAR HOTE')).toBe('food');
    expect(categoryKeyForMerchantName('METROPOLIS HEALTHCAR')).toBe('health');
    // Two letters are enough once `super` has matched, and only then.
    expect(categoryKeyForMerchantName('DURGA SWAMI SUPER MA')).toBe('groceries');
  });

  it('only lets the final word be a fragment', () => {
    // This is what keeps the pass honest. Each of these contains a keyword
    // as a run of letters, and none of them is that trade.
    expect(categoryKeyForMerchantName('Smart Kottayam T2DP')).toBeNull();
    expect(categoryKeyForMerchantName('Labham Shoppy')).toBeNull();
    expect(categoryKeyForMerchantName('Chocolate House')).toBeNull();
    // `metro` inside `metropolis`: a diagnostics chain, not a train.
    expect(categoryKeyForMerchantName('METROPOLIS HEALTHCARE')).toBe('health');
  });

  it('does not reach past four letters on its own', () => {
    // `rest` is enough of `restaurant` to mean something; `res` is not.
    expect(categoryKeyForMerchantName('NISARGA GARDEN REST')).toBe('food');
    expect(categoryKeyForMerchantName('NISARGA GARDEN RES')).toBeNull();
  });

  it('lets a brand beat the word it contains', () => {
    // The whole reason the rules run first. Both of these hold a keyword.
    expect(categoryKeyForMerchantName('Amazon Fresh')).toBe('groceries');
    expect(categoryKeyForMerchantName('Google Play Store')).toBe('entertainment');
    expect(categoryKeyForMerchantName('Apollo Pharmacy')).toBe('health');
  });

  it('has no keyword for parking', () => {
    // `park` is four letters of `parking`, and a time park is an arcade.
    // The keyword earned one payment on a real phone and got it wrong, so
    // it is not in the file. This is here to stop it being added back.
    expect(categoryKeyForMerchantName('DALSS TIME PARK')).toBeNull();
  });

  it('still leaves a person alone', () => {
    // Four of the five busiest payees on a real phone. A keyword pass that
    // reached these would be worse than no pass at all.
    expect(categoryKeyForMerchantName('Venkataraman')).toBeNull();
    expect(categoryKeyForMerchantName('SHEIKH ABDUL R M')).toBeNull();
    expect(categoryKeyForMerchantName('SRI NAVASAKTHI BALAN')).toBeNull();
    expect(categoryKeyForMerchantName('V Prasad')).toBeNull();
  });
});
