import { scanForAccount } from '../accountScan';
import type { RawSms } from '../types';

const AT = new Date(2026, 9, 24, 14, 30).getTime();

function scan(senderId: string, body: string) {
  const sms: RawSms = { providerId: 1, senderId, body, receivedAt: AT };
  return scanForAccount(sms);
}

describe('stage one account discovery', () => {
  test('a savings alert and a debit card alert are the same account', () => {
    // Found on a real device as two rows, `SBI ··0863 · Bank account` and
    // `SBI ··0863 · Card`, holding the same money.
    const savings = scan('CP-SBIUPI', 'Dear UPI user A/C X0863 debited by 210.0 on date 18Sep26 trf to BLINKIT');
    const debitCard = scan('AD-ATMSBI', 'Rs.450.00 spent on your SBI Debit Card XX0863 at SWIGGY on 18-Sep-26.');

    expect(savings).toEqual(debitCard);
    expect(savings?.accountType).toBe('BANK');
    expect(savings?.lastFour).toBe('0863');
  });

  test('a credit card is an account of its own', () => {
    const creditCard = scan('AD-ICICIT', 'INR 2,310.00 spent using ICICI Bank Credit Card XX5502 on 23-Oct-26 on MYNTRA.');
    expect(creditCard?.accountType).toBe('CARD');
    expect(creditCard?.lastFour).toBe('5502');
  });

  test('a message with no account digits contributes no account', () => {
    expect(scan('AD-HDFCBK', 'Rs.330 paid to SWIGGY. UPI Ref: 900011223344')).toBeNull();
  });

  test('a non-bank sender is never scanned', () => {
    expect(scan('AX-AMZNIN', 'Your order from A/c XX1234 has shipped')).toBeNull();
  });

  test('the same account masked two ways is one account', () => {
    const long = scan('AD-IDFCFB-S', 'Your A/c XXXXX528307 is debited by Rs.1.00 on 18-Oct-26.');
    const short = scan('JD-IDFCFB-S', 'Rs.500.00 credited to your A/c XX8307 on 18-Oct-26');
    expect(long).toEqual(short);
  });
});

describe('an account is only created by a message that moved money', () => {
  test('a prepaid transit card top-up creates no account', () => {
    // Found on a real device: nine of these produced an SBI account that held
    // no transactions at all.
    expect(
      scan(
        'JK-SBIBNK-S',
        'Your NCMC Prepaid Card 817453XXXXXX0863 is loaded with Rs. 20.00 successfully on 29/08/2026 22:37:25. Available balance is Rs. 40.00',
      ),
    ).toBeNull();
  });

  test('a standing instruction notice creates no account', () => {
    expect(
      scan(
        'JD-ICICIT-S',
        'You have activated Standing Instruction on ICICI Bank Debit Card 4495. Merchant: OpenRouterInc, Maximum Amount: USD 15000.00, Frequency: As presented',
      ),
    ).toBeNull();
  });

  test('a one-time password creates no account', () => {
    expect(
      scan(
        'AD-ICICIO-T',
        'is the OTP for transaction towards OPENROUTER, using ICICI Bank Debit Card XX4495. OTPs are SECRET. DO NOT disclose',
      ),
    ).toBeNull();
  });

  test('a failed service charge creates no account', () => {
    expect(
      scan(
        'AX-SBIBNK-S',
        'Service Charge of Rs. 236.0/- for your Debit Card ending with 7840 could not be recovered.Please contact branch for details.-SBI',
      ),
    ).toBeNull();
  });

  test('a real payment on the same card still creates it', () => {
    const spent = scan(
      'JD-ICICIT-S',
      'INR 592.04 spent using ICICI Bank Card XX5502 on 19-Oct-26 on Bigtree Enterta. Avl Limit: INR 57,286.50.',
    );
    expect(spent?.lastFour).toBe('5502');
    expect(spent?.accountType).toBe('CARD');
  });
});
