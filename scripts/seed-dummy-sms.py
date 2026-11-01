#!/usr/bin/env python3
"""
Seeds the connected emulator with dummy bank SMS: 100 debits and 100 credits,
spread across the last eleven months, five banks and four date formats.

Development only. `adb emu sms send` works on an emulator, not on hardware.
"""
import random
import subprocess
import sys
from datetime import date, timedelta

DEBITS = int(sys.argv[1]) if len(sys.argv) > 1 else 100
CREDITS = int(sys.argv[2]) if len(sys.argv) > 2 else 100

# "Today" on the emulator. Every generated date sits at or before it.
TODAY = date(2026, 10, 24)
MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

# Names from the rules file in section 5.4, so categorization has something to
# match, plus a few that are deliberately not in it.
MERCHANTS = [
    'SWIGGY', 'ZOMATO', 'ZEPTO', 'BLINKIT', 'BIGBASKET', 'DMART',
    'UBER', 'OLA', 'RAPIDO', 'NAMMA METRO', 'IRCTC', 'REDBUS', 'INDIAN OIL',
    'AMAZON', 'FLIPKART', 'MYNTRA', 'AJIO', 'NYKAA', 'CROMA', 'DECATHLON',
    'STARBUCKS', 'CHAI POINT', 'THIRD WAVE COFFEE', 'DOMINOS', 'KFC',
    'NETFLIX', 'SPOTIFY', 'AIRTEL', 'JIO', 'BESCOM', 'ACT FIBERNET',
    'APOLLO PHARMACY', 'PHARMEASY', 'BOOKMYSHOW', 'PVR', 'CULT FIT',
    # Not in the rules file: these must come out needing a category.
    'NAMMA YATRI', 'SRI LAKSHMI STORES', 'TEA STALL', 'GREEN LEAF SUPERMARKET',
]

CREDIT_SOURCES = ['SALARY ACME TECH', 'NEFT', 'IMPS', 'INTEREST', 'CASHBACK']
PEOPLE = ['Ananya R', 'Rahul M', 'Priya S', 'Vikram J', 'Rohit Nair']


def spread(index: int, total: int) -> date:
    """Dates clustered towards the present, so recent periods have substance."""
    if index < total * 0.18:
        days_ago = random.randint(0, 6)        # this week
    elif index < total * 0.42:
        days_ago = random.randint(7, 29)       # this month and last
    else:
        days_ago = random.randint(30, 330)
    return TODAY - timedelta(days=days_ago)


def amount(small: bool) -> str:
    value = random.choice([45, 60, 99, 120, 149, 199, 240, 320, 386, 410, 499])\
        if small else random.choice([640, 899, 1172, 1899, 2310, 3400, 5000, 8600])
    return f'{value}.00'


def rupees(value: str) -> str:
    whole = int(float(value))
    return f'{whole:,}.00'


def send(sender: str, body: str) -> None:
    subprocess.run(
        ['adb', 'emu', 'sms', 'send', sender, body],
        check=True, capture_output=True, timeout=30,
    )


messages = []

for i in range(DEBITS):
    when = spread(i, DEBITS)
    merchant = random.choice(MERCHANTS)
    value = amount(random.random() < 0.7)
    rrn = f'{500000000000 + i * 37 + 11:012d}'
    bank = random.choice(['hdfc', 'icici', 'idfc', 'axis', 'sbi'])

    if bank == 'hdfc':
        when_text = f'{when.day:02d}-{MONTHS[when.month - 1]}-{when.year % 100:02d}'
        messages.append(('AD-HDFCBK',
            f'Rs.{value} debited from A/c XX4821 on {when_text} to {merchant} '
            f'(UPI Ref No {rrn})'))
    elif bank == 'icici':
        when_text = f'{when.day:02d}-{MONTHS[when.month - 1]}-{when.year % 100:02d}'
        messages.append(('AD-ICICIT',
            f'ICICI Bank Acct XX7765 debited for Rs {value} on {when_text}; '
            f'{merchant} credited. UPI: {rrn}. Updated Bal: Rs 24,180.00'))
    elif bank == 'idfc':
        when_text = f'{when.day:02d}/{when.month:02d}/{when.year % 100:02d}'
        messages.append(('AD-IDFCFB',
            f'Your A/c XX8307 debited by Rs. {value} on {when_text}; {merchant} '
            f'credited. RRN {rrn}. Available balance Rs. 31,204.75.'))
    elif bank == 'axis':
        when_text = f'{when.day:02d}-{when.month:02d}-{when.year}'
        clock = f'{random.randint(8, 21):02d}:{random.randint(0, 59):02d}:00'
        messages.append(('AD-AXISBK',
            f'INR {value} debited from A/c no. XX589034 on {merchant} {when_text} '
            f'{clock} IST. Avl bal: INR 76,420.10.'))
    else:
        when_text = f'{when.day:02d}{MONTHS[when.month - 1]}{when.year % 100:02d}'
        messages.append(('CP-SBIUPI',
            f'Dear UPI user A/C X0937 debited by {value} on date {when_text} '
            f'trf to {merchant} refno {rrn}'))

for i in range(CREDITS):
    when = spread(i, CREDITS)
    value = amount(random.random() < 0.6)
    rrn = f'{700000000000 + i * 53 + 7:012d}'
    kind = random.random()

    if kind < 0.25:
        when_text = f'{when.day:02d}-{MONTHS[when.month - 1]}-{when.year % 100:02d}'
        messages.append(('AD-HDFCBK',
            f'Rs.{rupees(value)} credited to A/c XX4821 on {when_text} by '
            f'{random.choice(CREDIT_SOURCES)}. Avl Bal Rs.1,42,900.00'))
    elif kind < 0.5:
        when_text = f'{when.day:02d}/{when.month:02d}/{when.year % 100:02d}'
        messages.append(('AD-IDFCFB',
            f'Rs.{value} credited to your A/c XX8307 on {when_text}. RRN {rrn}'))
    elif kind < 0.75:
        when_text = f'{when.day:02d}-{MONTHS[when.month - 1]}-{when.year % 100:02d}'
        messages.append(('AD-ICICIT',
            f'ICICI Bank Acct XX7765 credited with Rs {value} on {when_text} '
            f'from {random.choice(PEOPLE)}. UPI: {rrn}'))
    else:
        when_text = f'{when.day:02d}-{MONTHS[when.month - 1]}-{when.year % 100:02d}'
        messages.append(('AD-ESAFBK',
            f'Your A/c XXX7143 is credited with Rs. {value} on {when_text} '
            f'by UPI Ref No: {rrn}'))

random.seed(24)
random.shuffle(messages)

for index, (sender, body) in enumerate(messages, start=1):
    send(sender, body)
    if index % 25 == 0:
        print(f'  {index} of {len(messages)} sent')

print(f'Done: {DEBITS} debits and {CREDITS} credits.')
