#!/usr/bin/env python3
"""Derive non-personal invoice totals from the official UCI Online Retail ZIP."""
import hashlib
import io
import json
import sys
from decimal import Decimal, ROUND_HALF_UP
from xml.etree.ElementTree import iterparse
from zipfile import ZipFile

EXPECTED_SHA256 = 'f5385cbb54bbebf7196389109c6b0621faab0c304e3702548165e71c84aede8b'
if len(sys.argv) != 2:
    raise SystemExit('Usage: python3 server/generate-uci-baskets.py /path/to/online+retail.zip')
with open(sys.argv[1], 'rb') as source:
    archive = source.read()
if hashlib.sha256(archive).hexdigest() != EXPECTED_SHA256:
    raise SystemExit('The UCI archive hash does not match the documented source.')
with ZipFile(io.BytesIO(archive)) as outer:
    workbook = outer.read('Online Retail.xlsx')
invoices = {}
with ZipFile(io.BytesIO(workbook)) as book, book.open('xl/worksheets/sheet1.xml') as sheet:
    for _, row in iterparse(sheet, events=('end',)):
        if not row.tag.endswith('}row'):
            continue
        if row.attrib['r'] == '1':
            row.clear()
            continue
        cells = {}
        for cell in row:
            column = ''.join(c for c in cell.attrib.get('r', '') if c.isalpha())
            if column in ('A', 'D', 'F'):
                value = next((v.text for v in cell if v.tag.endswith('}v')), None)
                cells[column] = (cell.attrib.get('t'), value)
        row.clear()
        invoice_type, invoice = cells.get('A', (None, None))
        if invoice_type == 's' or not invoice or not invoice.isdigit():
            continue
        entry = invoices.setdefault(invoice, [0, Decimal(0), True])
        try:
            quantity = int(cells['D'][1])
            price = Decimal(cells['F'][1])
        except (KeyError, TypeError, ValueError):
            entry[2] = False
            continue
        if quantity <= 0 or price <= 0:
            entry[2] = False
        entry[0] += 1
        entry[1] += quantity * price
eligible = []
for invoice, (lines, total, valid) in invoices.items():
    cents = int((total * 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
    if valid and 2 <= cents <= 100000:
        eligible.append([invoice, lines, cents])
eligible.sort(key=lambda basket: hashlib.sha256(('still-uci-v1:' + basket[0]).encode()).digest())
selected = eligible[:2000]
if len(selected) != 2000:
    raise SystemExit(f'Expected 2,000 eligible invoices, found {len(selected)}')
with open('server/uci-baskets.mjs', 'w', encoding='utf-8') as output:
    output.write('// Invoice number, line count, and invoice total in pence.\n')
    output.write('// Generated from the official UCI Online Retail workbook; see docs/personas.md.\n')
    output.write('export const UCI_BASKETS = Object.freeze([\n')
    for basket in selected:
        output.write('  ' + json.dumps(basket, separators=(',', ':')) + ',\n')
    output.write(']);\n')
print(f'Selected {len(selected)} invoices from {len(eligible)} eligible invoices.')
