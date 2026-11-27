# Handoff — Takar Trade Assurance (diperbarui 27 Nov 2026, 13:15 WIB)

> **Update 27 Nov:** kedua kasus SETTLED. Praman second 24 Nov 05:32 UTC (tx 0x28d3ff9c… v5, 0x976d78bb… v4). Finalize 27 Nov oleh wallet burner `0xf95f01c73b3ce68473B0FF48643367fD5443244e` (finalize permissionless; key di `.env` sebagai `FINALIZER_KEY`, diisi faucet Google Cloud): kasus 1 `0x82aa3076…dd32` (supplier 1.0), kasus 2 `0x78876aca…a6c5` (0.96 / 0.04, bond supplier 0.5 → buyer). `.env` lama TIDAK ada di device ini (key resolver tertinggal di device Indonesia); `vercel env pull` mengembalikan nilai kosong. **27 Nov sore:** `AGENT_PRIVATE_KEY` di device ini = Rabby "hackathon testing" `0xdbE1096badDcAbD27e89B3D9a11F13Bd39449e09` (bukan resolver; hanya bisa bayar miner/open/check). Deal 2 (v4) = ronde HOLD (MEGASTAR 61 km di laut), tidak bisa di-propose dari key ini; buyer bisa reclaim setelah GRACE. Invoice miner 302 error 404 → pakai `TAKAR_INVOICE_MINERS=7455,6164`. Video: `video/make-trade.mjs` + komposisi `Trade` → `media/takar-trade-assurance.mp4`.

Melanjutkan kerja di device lain. Semua angka di bawah dicek on-chain pada 24 Nov 2026 ~07:10 WIB.

## 1. Setup di device baru

```bash
git clone https://github.com/PugarHuda/takar.git
cd takar
npm install                     # Node >= 20
# .env TIDAK ada di git. Salin manual dari device lama (USB / password manager), jangan lewat chat/Discord.
npm test                        # harus lolos: "trade: 20 checks ok", "trade payable: 6 checks ok", dst.
vercel login && vercel link     # pilih project "takar-outcome" (team_NdlwQPgRp4Fn2WzyuKh1BLB2)
```

Deploy situs: `vercel deploy --prod --yes` dari folder `takar/`, domain `https://takar-telegraph.vercel.app`.
Ingat: batas 100 deploy/hari. Jangan jalankan `agent/deploy.mjs` (itu deploy kontrak, makan USDC).

### Isi `.env` yang dibutuhkan (nama saja, nilai ada di device lama)

| Key | Untuk apa |
|---|---|
| `AGENT_PRIVATE_KEY` | Resolver 1 Takar: propose, bayar bukti dari miner |
| `SERVER_PAYER_KEY` | Resolver 2 Takar: second hanya untuk deal yang tidak dipersengketakan |
| `TAKAR_COUNTERPARTY_KEY` | Wallet supplier (demo) |
| `TAKAR_BUYER_KEY` | Wallet buyer (demo) |
| `TAKAR_RESOLVER3_KEY`, `TAKAR_SIGNING_KEY`, `TAKAR_ANCHOR_KEY` | Fitur lain Takar (attest/anchor) |
| `RPC` | `https://ethereum-sepolia-rpc.publicnode.com` |
| `TELEGRAPH_NODE` | `https://devnode.telegraphprotocol.com` |
| `TAKAR_SETTLE4P` | `0x310275e6D66818E068245326bB9e398822304248` (kasus 1). **Perhatian:** di `.env` ada dua baris `TAKAR_SETTLE4P`; yang terakhir (0x3102…) yang dipakai. |
| `TAKAR_SETTLE5` | `0xa6D0482cBF29FE43fB644F33f7a020766AF4A42B` (kasus 2) |
| `SUMOPOD_API_KEY`, `SUMOPOD_MODEL`, `TROVE_USERNAME` | Layanan lain |

## 2. Status saat ini

Halaman: https://takar-telegraph.vercel.app/trade.html — log: `receipts/trade-assurance/log.jsonl`, bukti per ronde: `receipts/trade-assurance/deal-*.json`.

| Kasus | Kontrak | Deal | State | Approvals | Menunggu |
|---|---|---|---|---|---|
| 1. Ferry MEGASTAR Tallinn→Helsinki | TakarSettle4 panel `0x3102…4304` | id 1 | proposed, **PAY** | 1/2 | Kursi Praman |
| 2. Sengketa kuantitas 1000 vs 960 | TakarSettle5 `0xa6D0…A42B` (Sourcify verified) | id 0 | proposed, **payout 0.96**, supplier dispute | 2/3 | Kursi Praman |

- Kursi Praman (resolver independen, tim lain, Discord `@antikunpiece`): `0x98021b20Efdb7ae2C57366010a6E0fDE207b4466`.
- Hash yang perlu di-`second` Praman:
  - Kasus 2: `second(0, 0x5a328eb1b97a5bc02f7df0908ca147c30a8b88ac298f5ba7e209eba719b1c4f2)` di TakarSettle5
  - Kasus 1: `second(1, 0x8f4d39493e214e5e5a5a1f6ae92779895aa9935140e6ed5295c213b40d3efcf2)` di TakarSettle4 panel
- Setelah Praman second: dispute window 10 menit, lalu `finalize`.
- Hasil yang diharapkan kasus 2: supplier 0.96 USDC, buyer 0.04, bond supplier (0.5) pindah ke buyer.

### Kenapa kasus 1 berakhir di panel
Ronde 1–2: kapal di laut + miner invoice tidak sepakat. Ronde 3: kapal sandar, ChainSight (302) menolak karena tanggal tidak ada / beda. Ronde 4: TradeWire (7455) cocok, ChainSight tidak menjawab. Jadi REVIEW → `panel` dengan proposal PAY + alasan tertulis. Key kedua Takar sengaja tidak ikut back review-nya sendiri.

## 3. Perintah

```bash
node --env-file=.env scripts/trade-assurance.mjs status            # kasus 1 (v4)
node --env-file=.env scripts/trade-assurance.mjs status --v5       # kasus 2 (v5)
node --env-file=.env scripts/trade-assurance.mjs finalize --id 1         # kasus 1, setelah window lewat
node --env-file=.env scripts/trade-assurance.mjs finalize --id 0 --v5    # kasus 2
# lainnya: setup | open | check --id N [--ledger "..."] | dispute --id N --as buyer|supplier | panel --id N --file ... --decision pay|refund --reason "..."
```

Miner: kapal 8818818 (Quay) + 70068 (VesselWire); invoice 7455 (TradeWire) + 302 (ChainSight); sanksi 9002, 710637/302 + OFAC Praman (MCP).
`check` dan `panel` **membayar miner dengan USDC sungguhan** (testnet node) — jalankan hanya kalau memang perlu ronde baru.

## 4. Komunikasi (sudah terkirim 24 Nov 07:05–07:06 WIB)

- DM Praman: https://discord.com/channels/@me/1574576204919472178 — detail kedua kasus + hash `second`.
- #hackathon (Telegraph Protocol): mention @antikunpiece minta cek DM. Aturan channel: tanpa link.
- DM Ahmed Ali: https://discord.com/channels/@me/1574355744709677127 — update progres; dijanjikan link tx settlement begitu jadi. **Progres selanjutnya dikirim ke DM Ahmed.**
- Thread showcase Takar: `<#1573302748940869652>`.
- Pesan keluar: draft dulu, bahasa Inggris, gaya singkat. Balas Praman = jangan otomatis, laporkan dulu ke user.

## 5. Watcher

Di device lama ada cron sesi Claude Code (`:13` dan `:43` tiap jam) yang mati kalau sesi ditutup. Di device baru, pasang ulang (minta Claude: "pasang watcher Trade Assurance") dengan tugas:
cek `status` + `status --v5`; kalau approvals sudah cukup dan `finalizesAt` lewat → `finalize`, deploy, commit + push, kirim link tx ke DM Ahmed, kabari user; cek juga balasan di DM Praman (lapor saja, jangan balas).
**Matikan watcher di device lama** supaya tidak dobel finalize/DM.

## 6. Belum selesai / TODO

1. ~~Rapikan langkah panel di trade.html~~ — selesai, live & di-push (commit caa315d).
2. ~~Tunggu Praman second → finalize kedua kasus → DM Ahmed link tx.~~ — selesai 27 Nov.
3. Kasus 1 belum punya ronde **HOLD** (kapal di laut, semua cek lain beres). Tambahkan saat MEGASTAR berlayar lagi (sandar ±1 jam sebelum berangkat; putaran Tallinn–Helsinki ±4 jam).
4. Video walkthrough kedua kasus, dibuat setelah settlement.
5. Heads-up ke operator miner 6164 (INVOICE_LEDGER_RECONCILE) sudah disebut di DM Praman: ledger total dibaca sebagai harga satuan (USD 12.40).
6. Season II Telegraph berakhir **1 Des 2026** — lihat `../SUBMISSION-S2.md` dan `../S2-ANALYSIS.md` (di luar repo ini, ikut disalin kalau perlu).

## 7. Perubahan terakhir (sudah live & di-push)

`trade.html`: langkah "Review goes to the panel" hanya menampilkan proposal + alasan (blockquote) + tx, tanpa mengulang tabel bukti; "Waiting for the outside seat" membedakan review call (2 dari 3) dan deal yang di-dispute (TakarSettle5: 3 dari 3). Tidak ada perubahan lokal yang tertinggal.
