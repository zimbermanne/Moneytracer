"""
African countries and their official currencies.

Used to populate the country/currency picker in the account-setup wizard
and to drive per-account currency formatting on invoices, quotations and
reports.
"""

# (country_name, ISO 3166-1 alpha-2, currency_code, currency_name)
AFRICAN_COUNTRY_CURRENCIES = [
    ("Algeria", "DZ", "DZD", "Algerian Dinar"),
    ("Angola", "AO", "AOA", "Angolan Kwanza"),
    ("Benin", "BJ", "XOF", "West African CFA Franc"),
    ("Botswana", "BW", "BWP", "Botswana Pula"),
    ("Burkina Faso", "BF", "XOF", "West African CFA Franc"),
    ("Burundi", "BI", "BIF", "Burundian Franc"),
    ("Cabo Verde", "CV", "CVE", "Cape Verdean Escudo"),
    ("Cameroon", "CM", "XAF", "Central African CFA Franc"),
    ("Central African Republic", "CF", "XAF", "Central African CFA Franc"),
    ("Chad", "TD", "XAF", "Central African CFA Franc"),
    ("Comoros", "KM", "KMF", "Comorian Franc"),
    ("Congo, Republic of the", "CG", "XAF", "Central African CFA Franc"),
    ("Congo, Democratic Republic of the", "CD", "CDF", "Congolese Franc"),
    ("Djibouti", "DJ", "DJF", "Djiboutian Franc"),
    ("Egypt", "EG", "EGP", "Egyptian Pound"),
    ("Equatorial Guinea", "GQ", "XAF", "Central African CFA Franc"),
    ("Eritrea", "ER", "ERN", "Eritrean Nakfa"),
    ("Eswatini", "SZ", "SZL", "Swazi Lilangeni"),
    ("Ethiopia", "ET", "ETB", "Ethiopian Birr"),
    ("Gabon", "GA", "XAF", "Central African CFA Franc"),
    ("Gambia", "GM", "GMD", "Gambian Dalasi"),
    ("Ghana", "GH", "GHS", "Ghanaian Cedi"),
    ("Guinea", "GN", "GNF", "Guinean Franc"),
    ("Guinea-Bissau", "GW", "XOF", "West African CFA Franc"),
    ("Ivory Coast", "CI", "XOF", "West African CFA Franc"),
    ("Kenya", "KE", "KES", "Kenyan Shilling"),
    ("Lesotho", "LS", "LSL", "Lesotho Loti"),
    ("Liberia", "LR", "LRD", "Liberian Dollar"),
    ("Libya", "LY", "LYD", "Libyan Dinar"),
    ("Madagascar", "MG", "MGA", "Malagasy Ariary"),
    ("Malawi", "MW", "MWK", "Malawian Kwacha"),
    ("Mali", "ML", "XOF", "West African CFA Franc"),
    ("Mauritania", "MR", "MRU", "Mauritanian Ouguiya"),
    ("Mauritius", "MU", "MUR", "Mauritian Rupee"),
    ("Morocco", "MA", "MAD", "Moroccan Dirham"),
    ("Mozambique", "MZ", "MZN", "Mozambican Metical"),
    ("Namibia", "NA", "NAD", "Namibian Dollar"),
    ("Niger", "NE", "XOF", "West African CFA Franc"),
    ("Nigeria", "NG", "NGN", "Nigerian Naira"),
    ("Rwanda", "RW", "RWF", "Rwandan Franc"),
    ("Sao Tome and Principe", "ST", "STN", "Sao Tome and Principe Dobra"),
    ("Senegal", "SN", "XOF", "West African CFA Franc"),
    ("Seychelles", "SC", "SCR", "Seychellois Rupee"),
    ("Sierra Leone", "SL", "SLE", "Sierra Leonean Leone"),
    ("Somalia", "SO", "SOS", "Somali Shilling"),
    ("South Africa", "ZA", "ZAR", "South African Rand"),
    ("South Sudan", "SS", "SSP", "South Sudanese Pound"),
    ("Sudan", "SD", "SDG", "Sudanese Pound"),
    ("Tanzania", "TZ", "TZS", "Tanzanian Shilling"),
    ("Togo", "TG", "XOF", "West African CFA Franc"),
    ("Tunisia", "TN", "TND", "Tunisian Dinar"),
    ("Uganda", "UG", "UGX", "Ugandan Shilling"),
    ("Zambia", "ZM", "ZMW", "Zambian Kwacha"),
    ("Zimbabwe", "ZW", "ZWL", "Zimbabwean Dollar"),
]

# Convenience lookups
COUNTRY_TO_CURRENCY = {c[0]: c[2] for c in AFRICAN_COUNTRY_CURRENCIES}
VALID_COUNTRIES = {c[0] for c in AFRICAN_COUNTRY_CURRENCIES}
VALID_CURRENCY_CODES = {c[2] for c in AFRICAN_COUNTRY_CURRENCIES}


def default_currency_for_country(country: str) -> str:
    return COUNTRY_TO_CURRENCY.get(country, "TZS")
