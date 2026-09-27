# Laporan Verifikasi API (CLAUDE.md §8)

File ini dihasilkan otomatis oleh `npm run verify:api`. Jangan diedit manual.

- Dijalankan: 2026-09-26T18:42:34.009Z
- Tanggal acuan data: 2026-09-25
- Base URL: `https://api.sectors.app/v2` (v1 sudah dimatikan 2026-05-11, seluruh /v1/* -> HTTP 410)
- Autentikasi: header `Authorization: <API_KEY>`, raw tanpa prefix `Bearer`
- Estimasi credit terpakai pada run ini: 9

## Ringkasan

| Endpoint | Tahap | Status | Latensi | Jumlah item | Credit |
|---|---|---|---|---|---|
| Top Company Movers | 1 | 200 | 1879 ms | - | 1 |
| Most Traded Stocks | 1 | 200 | 106 ms | 10 | 2 |
| Daily Transaction Data | 2 | 200 | 111 ms | 28 | 1 |
| Broker Activity Per Symbol | 2 | 200 | 153 ms | 11 | 1 |
| Top Accumulations and Distributions Per Broker | 2 | 200 | 3958 ms | 10 | 2 |
| Daily Net Foreign Inflow | 2 | 200 | 201 ms | 23 | 1 |
| News Articles | 2 | 200 | 125 ms | 20 | 1 |

## Top Company Movers

`https://api.sectors.app/v2/companies/top-changes/?n_stock=10&classifications=top_gainers&periods=1d&min_mcap_billion=5000`

Header kuota/rate limit dari server:

- `limit-consumption: 1`

Struktur JSON aktual:

```
top_gainers.1d[]: array(10)
top_gainers.1d[].name: string
top_gainers.1d[].symbol: string
top_gainers.1d[].price_change: number
top_gainers.1d[].last_close_price: number
top_gainers.1d[].latest_close_date: string
```

Tidak ada field kosong/null pada sampel ini.

## Most Traded Stocks

`https://api.sectors.app/v2/most-traded/?start=2026-09-25&end=2026-09-25&n_stock=10&adjusted=true`

Header kuota/rate limit dari server:

- `limit-consumption: 2`

Struktur JSON aktual:

```
2026-09-25[]: array(10)
2026-09-25[].symbol: string
2026-09-25[].company_name: string
2026-09-25[].volume: number
2026-09-25[].price: number
```

Tidak ada field kosong/null pada sampel ini.

## Daily Transaction Data

`https://api.sectors.app/v2/daily/BBCA/?start=2026-08-16&end=2026-09-25`

Server tidak mengirim header rate limit pada response ini.

Struktur JSON aktual:

```
[]: array(28)
[].symbol: string
[].date: string
[].close: number
[].open: number
[].high: number
[].low: number
[].volume: number
[].market_cap: number
```

Tidak ada field kosong/null pada sampel ini.

## Broker Activity Per Symbol

`https://api.sectors.app/v2/broker-summary/BBCA/?start=2026-08-26&end=2026-09-25`

Server tidak mengirim header rate limit pada response ini.

Struktur JSON aktual:

```
symbol: string
start: string
end: string
data[]: array(11)
data[].date: string
data[].summary[]: array(77)
data[].summary[].broker_code: string
data[].summary[].bfreq: number
data[].summary[].blot: number
data[].summary[].bval: number
data[].summary[].bavg_per_share: number
data[].summary[].sfreq: number
data[].summary[].slot: number
data[].summary[].sval: number
data[].summary[].savg_per_share: null
data[].summary[].nlot: number
data[].summary[].nval: number
data[].summary[].navg_per_share: number
data[].summary[].f_bfreq: null
data[].summary[].f_blot: null
data[].summary[].f_bval: null
data[].summary[].f_bavg_per_share: null
data[].summary[].d_bavg_per_share: number
data[].summary[].f_sfreq: null
data[].summary[].f_slot: null
data[].summary[].f_sval: null
data[].summary[].f_savg_per_share: null
data[].summary[].d_savg_per_share: null
```

Field kosong/null yang ditemukan pada data nyata (wajib ditangani di workflow):

- `data[].summary[].savg_per_share` — kosong pada 43 kemunculan
- `data[].summary[].f_bfreq` — kosong pada 145 kemunculan
- `data[].summary[].f_blot` — kosong pada 145 kemunculan
- `data[].summary[].f_bval` — kosong pada 145 kemunculan
- `data[].summary[].f_bavg_per_share` — kosong pada 154 kemunculan
- `data[].summary[].f_sfreq` — kosong pada 145 kemunculan
- `data[].summary[].f_slot` — kosong pada 145 kemunculan
- `data[].summary[].f_sval` — kosong pada 145 kemunculan
- `data[].summary[].f_savg_per_share` — kosong pada 163 kemunculan
- `data[].summary[].d_savg_per_share` — kosong pada 58 kemunculan
- `data[].summary[].d_bavg_per_share` — kosong pada 33 kemunculan
- `data[].summary[].bavg_per_share` — kosong pada 14 kemunculan
- `data[].summary[].navg_per_share` — kosong pada 1 kemunculan

## Top Accumulations and Distributions Per Broker

`https://api.sectors.app/v2/broker-activity/YP/top/?start=2026-09-11&end=2026-09-25`

Header kuota/rate limit dari server:

- `limit-consumption: 2`

Struktur JSON aktual:

```
broker_code: string
start: string
end: string
foreign: boolean
top_accumulations[]: array(10)
top_accumulations[].rank: number
top_accumulations[].symbol: string
top_accumulations[].net_idr: number
top_accumulations[].buy_idr: number
top_accumulations[].sell_idr: number
top_accumulations[].foreign_net_idr: number
top_accumulations[].foreign_buy_idr: number
top_accumulations[].foreign_sell_idr: number
top_distributions[]: array(10)
top_distributions[].rank: number
top_distributions[].symbol: string
top_distributions[].net_idr: number
top_distributions[].buy_idr: number
top_distributions[].sell_idr: number
top_distributions[].foreign_net_idr: number
top_distributions[].foreign_buy_idr: number
top_distributions[].foreign_sell_idr: number
```

Tidak ada field kosong/null pada sampel ini.

## Daily Net Foreign Inflow

`https://api.sectors.app/v2/foreign-flow/BBCA/?start=2026-08-26&end=2026-09-25`

Server tidak mengirim header rate limit pada response ini.

Struktur JSON aktual:

```
symbol: string
start: string
end: string
data[]: array(23)
data[].date: string
data[].net_foreign_inflow: number
data[].foreign_buy_idr: number
data[].foreign_sell_idr: number
data[].foreign_share: number
```

Tidak ada field kosong/null pada sampel ini.

## News Articles

`https://api.sectors.app/v2/news/?start=2026-09-18&end=2026-09-25&limit=30&symbols=BBCA`

Server tidak mengirim header rate limit pada response ini.

Struktur JSON aktual:

```
results[]: array(20)
results[].title: string
results[].body: string
results[].source: string
results[].thumbnail: string
results[].timestamp: string
results[].sector: string
results[].sub_sector[]: string
results[].tags[]: string
results[].symbols[]: string
results[].dimension.future: number
results[].dimension.dividend: number
results[].dimension.ownership: number
results[].dimension.technical: number
results[].dimension.valuation: number
results[].dimension.financials: number
results[].dimension.management: number
results[].dimension.sustainability: number
pagination.total_count: number
pagination.showing: number
pagination.limit: number
pagination.offset: number
pagination.has_next: boolean
pagination.has_previous: boolean
pagination.next_offset: null
pagination.previous_offset: null
```

Field kosong/null yang ditemukan pada data nyata (wajib ditangani di workflow):

- `results[].thumbnail` — kosong pada 1 kemunculan
- `pagination.next_offset` — kosong pada 1 kemunculan
- `pagination.previous_offset` — kosong pada 1 kemunculan
