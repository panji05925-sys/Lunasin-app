"use client";

import React, { useEffect, useState, useSyncExternalStore } from "react";

// ==========================================
// TYPES
// ==========================================
type TipeTransaksi = "pemasukan" | "pengeluaran";
type DropdownDTI = 0 | 25 | 50;
type TabType = "ringkasan" | "transaksi" | "pinjaman" | "laporan" | "simulasi";

interface Transaksi {
  id: number;
  judul: string;
  kategori: string;
  tipe: TipeTransaksi;
  nominal: number;
  tanggal: string;
}

interface Pinjaman {
  id: number;
  nama: string;
  totalUtang: number;
  sisaUtang: number;
  cicilanPerBulan: number;
  jatuhTempo: string;
  status: "aktif" | "lunas";
}

interface DataAkun {
  saldo: number;
  pemasukan: number;
  pengeluaran: number;
  transaksiList: Transaksi[];
  pinjamanList: Pinjaman[];
}

interface DtiStatus {
  label: string;
  color: string;
  bg: string;
}

// ==========================================
// KONSTANTA
// ==========================================
const NAV_ITEMS: { key: TabType; label: string; icon: string }[] = [
  { key: "ringkasan", label: "Ringkasan", icon: "🏠" },
  { key: "transaksi", label: "Transaksi", icon: "🧾" },
  { key: "pinjaman", label: "Pinjaman", icon: "🏦" },
  { key: "laporan", label: "Laporan", icon: "📊" },
  { key: "simulasi", label: "Simulasi", icon: "📉" },
];

const INPUT_CLASS =
  "w-full p-3 bg-white border border-gray-300 rounded-xl text-sm text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-teal-500 outline-none";

const STORAGE_PREFIX = "lunasin:data:";
const BATAS_ANGGARAN = 5000000;

// ==========================================
// FUNGSI BANTUAN
// ==========================================
let idCounter = 0;
const generateId = () => {
  idCounter += 1;
  return Date.now() * 1000 + idCounter;
};

const formatRupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

const formatTanggal = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const bacaDataAkun = (id: string): DataAkun | null => {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + id);
    return raw ? (JSON.parse(raw) as DataAkun) : null;
  } catch {
    return null;
  }
};

const simpanDataAkun = (id: string, data: DataAkun) => {
  try {
    localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(data));
  } catch {
    // penyimpanan penuh / diblokir: abaikan
  }
};

const getDtiStatus = (dti: number): DtiStatus => {
  if (dti > 40) {
    return { label: "Berbahaya", color: "text-rose-600", bg: "bg-rose-50" };
  }
  if (dti > 30) {
    return { label: "Waspada", color: "text-amber-600", bg: "bg-amber-50" };
  }
  return { label: "Sehat", color: "text-emerald-600", bg: "bg-emerald-50" };
};

const perbaruiPinjamanSetelahBayar = (
  list: Pinjaman[],
  pinjamanId: number,
  bayar: number,
): Pinjaman[] =>
  list.map((p) => {
    if (p.id !== pinjamanId) return p;
    const sisaBaru = Math.max(p.sisaUtang - bayar, 0);
    return {
      ...p,
      sisaUtang: sisaBaru,
      status: sisaBaru <= 0 ? "lunas" : "aktif",
    };
  });

// ==========================================
// AUTENTIKASI (username + kata sandi)
// ==========================================
// Autentikasi username + kata sandi (disimpan di browser / localStorage).
// Kata sandi TIDAK disimpan polos: di-hash dengan PBKDF2 + salt acak.
// Catatan: cocok untuk prototipe/demo. Untuk aplikasi sungguhan, gunakan backend.

interface Akun {
  id: string; // sama dengan username
  nama: string;
}

type Hasil = { ok: true } | { ok: false; pesan: string };

interface AkunTersimpan {
  nama: string;
  salt: string;
  hash: string;
}

type DaftarAkunTersimpan = Record<string, AkunTersimpan>;

const KEY_AKUN = "lunasin:akun";
const KEY_SESI = "lunasin:sesi";
const POLA_USERNAME = /^[a-z0-9_]{3,20}$/;

const encoder = new TextEncoder();

const toHex = (buf: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );

const fromHex = (hex: string) =>
  Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));

const buatHash = async (password: string, saltHex: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: fromHex(saltHex),
      iterations: 100000,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return toHex(bits);
};

const bacaDaftar = (): DaftarAkunTersimpan => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY_AKUN) ?? "{}");
    return parsed && typeof parsed === "object"
      ? (parsed as DaftarAkunTersimpan)
      : {};
  } catch {
    return {};
  }
};

const simpanDaftar = (daftarAkun: DaftarAkunTersimpan) => {
  localStorage.setItem(KEY_AKUN, JSON.stringify(daftarAkun));
};

// --- Pembaca sesi untuk React (useSyncExternalStore) ---
const pendengarSesi = new Set<() => void>();

const subscribeSesi = (callback: () => void) => {
  pendengarSesi.add(callback);
  return () => {
    pendengarSesi.delete(callback);
  };
};

const umumkanSesi = () => {
  pendengarSesi.forEach((fn) => fn());
};

// undefined = belum tahu (server / sebelum hydration), null = belum masuk
const getSesiIdClient = (): string | null | undefined => {
  try {
    return localStorage.getItem(KEY_SESI);
  } catch {
    return null;
  }
};

const getSesiIdServer = (): string | null | undefined => undefined;

const normalisasi = (username: string) => username.trim().toLowerCase();

async function daftar(
  username: string,
  nama: string,
  password: string,
): Promise<Hasil> {
  const id = normalisasi(username);

  if (!POLA_USERNAME.test(id)) {
    return {
      ok: false,
      pesan: "Username 3–20 karakter: huruf, angka, atau garis bawah (_).",
    };
  }
  if (password.length < 6) {
    return { ok: false, pesan: "Kata sandi minimal 6 karakter." };
  }

  const daftarAkun = bacaDaftar();
  if (daftarAkun[id]) {
    return { ok: false, pesan: "Username sudah dipakai. Pilih yang lain." };
  }

  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await buatHash(password, salt);
  daftarAkun[id] = { nama: nama.trim() || id, salt, hash };
  simpanDaftar(daftarAkun);

  localStorage.setItem(KEY_SESI, id);
  umumkanSesi();
  return { ok: true };
}

async function masuk(username: string, password: string): Promise<Hasil> {
  const id = normalisasi(username);
  const akun = bacaDaftar()[id];

  if (!akun) {
    return { ok: false, pesan: "Username atau kata sandi salah!" };
  }

  const hash = await buatHash(password, akun.salt);
  if (hash !== akun.hash) {
    return { ok: false, pesan: "Username atau kata sandi salah!" };
  }

  localStorage.setItem(KEY_SESI, id);
  umumkanSesi();
  return { ok: true };
}

function getSesi(): Akun | null {
  try {
    const id = localStorage.getItem(KEY_SESI);
    if (!id) return null;
    const akun = bacaDaftar()[id];
    return akun ? { id, nama: akun.nama } : null;
  } catch {
    return null;
  }
}

function keluar() {
  localStorage.removeItem(KEY_SESI);
  umumkanSesi();
}

const AUTH_INPUT_CLASS =
  "w-full p-4 bg-gray-50 border border-gray-300 rounded-xl text-sm text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-teal-500 outline-none transition-all";

const getLabelTombolAuth = (authLoading: boolean, isDaftar: boolean) => {
  if (authLoading) return "Memproses...";
  if (isDaftar) return "Daftar";
  return "Masuk Sekarang";
};

// ==========================================
// KOMPONEN: LAYAR MEMUAT
// ==========================================
function LayarMemuat() {
  return (
    <div className="flex h-screen max-w-md mx-auto bg-teal-900 justify-center items-center text-white font-sans text-sm">
      Memuat...
    </div>
  );
}

// ==========================================
// KOMPONEN: LAYAR MASUK / DAFTAR
// ==========================================
function LayarAuth() {
  const [isDaftar, setIsDaftar] = useState(false);
  const [nama, setNama] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const hasil = isDaftar
        ? await daftar(username, nama, password)
        : await masuk(username, password);
      // Jika berhasil, sesi tersimpan dan layar otomatis berganti ke dashboard
      if (!hasil.ok) setError(hasil.pesan);
    } catch {
      setError("Terjadi kesalahan. Coba lagi.");
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = () => {
    setError("");
    setIsDaftar((prev) => !prev);
  };

  return (
    <div className="flex h-screen max-w-md mx-auto bg-teal-900 justify-center items-center p-6 text-white font-sans">
      <form
        onSubmit={handleSubmit}
        className="bg-white p-8 rounded-3xl shadow-2xl w-full text-gray-800 space-y-6"
        aria-label={isDaftar ? "Form Daftar" : "Form Masuk"}
      >
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-teal-600 rounded-2xl mx-auto flex justify-center items-center text-3xl text-white font-bold mb-4">
            L
          </div>
          <h1 className="text-2xl font-bold">
            {isDaftar ? "Buat Akun" : "Lunasin App"}
          </h1>
          <p className="text-sm text-gray-500">
            {isDaftar
              ? "Pilih username dan kata sandi untuk akun Anda"
              : "Silakan masuk untuk memonitor keuangan"}
          </p>
        </div>

        {error && (
          <p className="text-red-500 text-xs text-center font-bold">{error}</p>
        )}

        <div className="space-y-4">
          {isDaftar && (
            <input
              type="text"
              placeholder="Nama lengkap"
              required
              aria-label="Nama lengkap"
              value={nama}
              onChange={(e) => setNama(e.target.value)}
              className={AUTH_INPUT_CLASS}
            />
          )}
          <input
            type="text"
            placeholder="Username"
            required
            autoComplete="username"
            autoCapitalize="none"
            aria-label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={AUTH_INPUT_CLASS}
          />
          {isDaftar && (
            <p className="text-[11px] text-gray-400 -mt-2">
              3–20 karakter: huruf, angka, atau garis bawah (_)
            </p>
          )}
          <input
            type="password"
            placeholder="Kata sandi (min. 6 karakter)"
            required
            minLength={6}
            autoComplete={isDaftar ? "new-password" : "current-password"}
            aria-label="Kata sandi"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={AUTH_INPUT_CLASS}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white font-bold py-4 rounded-xl shadow-lg transition-all active:scale-95"
        >
          {getLabelTombolAuth(loading, isDaftar)}
        </button>

        <p className="text-center text-sm text-gray-500">
          {isDaftar ? "Sudah punya akun?" : "Belum punya akun?"}{" "}
          <button
            type="button"
            onClick={handleToggle}
            className="font-bold text-teal-700"
          >
            {isDaftar ? "Masuk" : "Daftar"}
          </button>
        </p>
      </form>
    </div>
  );
}

// ==========================================
// KOMPONEN: HEADER
// ==========================================
interface HeaderUtamaProps {
  nama: string;
  onLogout: () => void;
  onTambah: () => void;
}

function HeaderUtama({ nama, onLogout, onTambah }: Readonly<HeaderUtamaProps>) {
  return (
    <header className="bg-white px-5 py-4 flex justify-between items-center border-b border-gray-100 z-10">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 bg-teal-700 rounded-xl flex justify-center items-center text-white font-bold text-lg">
          L
        </div>
        <div>
          <h1 className="font-bold text-gray-800 leading-tight">
            Halo, {nama}
          </h1>
          <p className="text-[10px] text-gray-400">
            November 2026 •{" "}
            <button
              onClick={onLogout}
              className="text-rose-500 font-bold hover:underline"
            >
              Keluar
            </button>
          </p>
        </div>
      </div>
      <button
        onClick={onTambah}
        aria-label="Tambah Transaksi Baru"
        className="w-10 h-10 bg-teal-600 text-white rounded-full font-bold text-2xl shadow-lg hover:bg-teal-700 transition-all active:scale-90 flex justify-center items-center pb-1"
      >
        +
      </button>
    </header>
  );
}

// ==========================================
// KOMPONEN: KARTU SALDO
// ==========================================
interface KartuSaldoProps {
  saldo: number;
  pemasukan: number;
  pengeluaran: number;
}

function KartuSaldo({
  saldo,
  pemasukan,
  pengeluaran,
}: Readonly<KartuSaldoProps>) {
  return (
    <div className="bg-teal-800 rounded-3xl p-6 text-white shadow-xl relative overflow-hidden">
      <div className="relative z-10">
        <p className="text-xs text-teal-200/80 mb-1">Saldo Bulan Ini</p>
        <h2 className="text-4xl font-extrabold tracking-tight">
          {formatRupiah(saldo)}
        </h2>
        {pemasukan > pengeluaran && (
          <span className="inline-block mt-3 px-3 py-1 bg-teal-600 text-teal-50 text-[10px] rounded-full font-bold">
            ↗ Arus Kas Positif
          </span>
        )}
      </div>
      <div className="relative z-10 pt-5 mt-5 border-t border-teal-600/50 flex justify-between text-xs">
        <div>
          <p className="text-teal-300">Pemasukan</p>
          <p className="text-sm font-bold mt-1">{formatRupiah(pemasukan)}</p>
        </div>
        <div>
          <p className="text-teal-300">Pengeluaran</p>
          <p className="text-sm font-bold mt-1">{formatRupiah(pengeluaran)}</p>
        </div>
      </div>
      <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-teal-600 rounded-full blur-3xl opacity-50"></div>
    </div>
  );
}

// ==========================================
// KOMPONEN: ITEM & DAFTAR TRANSAKSI
// ==========================================
function ItemTransaksi({ trx }: Readonly<{ trx: Transaksi }>) {
  const isMasuk = trx.tipe === "pemasukan";
  return (
    <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex justify-between items-center hover:shadow-md transition-shadow">
      <div className="flex items-center gap-4">
        <div
          className={`w-12 h-12 rounded-xl flex justify-center items-center text-xl font-bold ${
            isMasuk
              ? "bg-emerald-50 text-emerald-600"
              : "bg-rose-50 text-rose-600"
          }`}
        >
          {isMasuk ? "💰" : "💳"}
        </div>
        <div>
          <p className="text-sm font-bold text-gray-800">{trx.judul}</p>
          <p className="text-[11px] text-gray-400">
            {trx.kategori} • {formatTanggal(trx.tanggal)}
          </p>
        </div>
      </div>
      <span
        className={`text-sm font-bold ${
          isMasuk ? "text-emerald-600" : "text-rose-600"
        }`}
      >
        {isMasuk ? "+" : "-"}
        {formatRupiah(trx.nominal)}
      </span>
    </div>
  );
}

function DaftarTransaksi({
  transaksiList,
}: Readonly<{ transaksiList: Transaksi[] }>) {
  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-bold text-gray-800">Semua Transaksi</h3>
        <span className="text-xs text-teal-600 font-bold">
          {transaksiList.length} Catatan
        </span>
      </div>

      {transaksiList.length === 0 ? (
        <div className="bg-white p-6 rounded-2xl border border-dashed border-gray-300 text-center text-gray-400 text-sm">
          Belum ada transaksi.
          <br />
          Klik tombol &quot;+&quot; di atas untuk menambah pendapatan awal.
        </div>
      ) : (
        <div className="space-y-3">
          {transaksiList.map((trx) => (
            <ItemTransaksi key={trx.id} trx={trx} />
          ))}
        </div>
      )}
    </div>
  );
}

// ==========================================
// KOMPONEN: TAB PINJAMAN
// ==========================================
interface ItemPinjamanProps {
  pinjaman: Pinjaman;
  onBayar: (id: number, nominal: number) => void;
}

function ItemPinjaman({ pinjaman, onBayar }: Readonly<ItemPinjamanProps>) {
  const isAktif = pinjaman.status === "aktif";
  return (
    <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-4">
      <div className="flex justify-between items-start">
        <div>
          <h3 className="font-bold text-gray-800">{pinjaman.nama}</h3>
          <p className="text-[11px] text-gray-500 mt-1">
            Sisa: {formatRupiah(pinjaman.sisaUtang)}
          </p>
        </div>
        <span
          className={`px-2 py-1 text-[10px] font-bold rounded-md ${
            isAktif
              ? "bg-amber-100 text-amber-700"
              : "bg-emerald-100 text-emerald-700"
          }`}
        >
          {isAktif ? "AKTIF" : "LUNAS"}
        </span>
      </div>

      {isAktif && (
        <div className="bg-rose-50 border border-rose-100 p-2.5 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-2 text-rose-600">
            <span className="text-lg">🔔</span>
            <span className="text-[11px] font-bold">
              Jatuh Tempo: {pinjaman.jatuhTempo}
            </span>
          </div>
          <button
            onClick={() => onBayar(pinjaman.id, pinjaman.cicilanPerBulan)}
            className="bg-rose-600 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg shadow-sm active:scale-95"
          >
            Bayar {formatRupiah(pinjaman.cicilanPerBulan)}
          </button>
        </div>
      )}
    </div>
  );
}

interface TabPinjamanProps {
  pinjamanList: Pinjaman[];
  onTambah: () => void;
  onBayar: (id: number, nominal: number) => void;
}

function TabPinjaman({
  pinjamanList,
  onTambah,
  onBayar,
}: Readonly<TabPinjamanProps>) {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <h2 className="text-xl font-bold text-gray-800">Daftar Pinjaman</h2>
        <button
          onClick={onTambah}
          className="text-sm font-bold text-teal-600 bg-teal-50 px-3 py-1.5 rounded-lg"
        >
          + Pinjaman Baru
        </button>
      </div>

      {pinjamanList.length === 0 ? (
        <div className="bg-white p-6 rounded-2xl border border-dashed border-gray-300 text-center text-gray-400 text-sm">
          Tidak ada riwayat pinjaman aktif.
        </div>
      ) : (
        <div className="space-y-4">
          {pinjamanList.map((p) => (
            <ItemPinjaman key={p.id} pinjaman={p} onBayar={onBayar} />
          ))}
        </div>
      )}
    </div>
  );
}

// ==========================================
// KOMPONEN: TAB LAPORAN
// ==========================================
interface TabLaporanProps {
  pengeluaran: number;
  persentaseAnggaran: string;
  dtiDropdown: DropdownDTI;
  onDtiChange: (v: DropdownDTI) => void;
  dtiRatio: string;
  dtiStatus: DtiStatus;
  totalCicilanAktif: number;
  simulasiPemasukan: number;
}

function TabLaporan({
  pengeluaran,
  persentaseAnggaran,
  dtiDropdown,
  onDtiChange,
  dtiRatio,
  dtiStatus,
  totalCicilanAktif,
  simulasiPemasukan,
}: Readonly<TabLaporanProps>) {
  const warnaBar =
    Number(persentaseAnggaran) >= 90 ? "bg-rose-500" : "bg-teal-500";

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-800">Laporan Keuangan</h2>

      {/* ANGGARAN */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-3">
        <div className="flex justify-between text-sm">
          <span className="font-bold text-gray-800">Anggaran Bulanan</span>
          <span className="text-gray-500 text-xs">
            {formatRupiah(pengeluaran)} / {formatRupiah(BATAS_ANGGARAN)}
          </span>
        </div>
        <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${warnaBar}`}
            style={{ width: `${persentaseAnggaran}%` }}
          />
        </div>
        <p className="text-[11px] text-gray-400">
          {persentaseAnggaran}% anggaran terpakai
        </p>
      </div>

      {/* DTI */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-4">
        <h3 className="font-bold text-gray-800">
          Rasio Utang terhadap Pendapatan (DTI)
        </h3>

        <div>
          <label htmlFor="dti-sim" className="block text-xs text-gray-500 mb-1">
            Simulasi penurunan pemasukan
          </label>
          <select
            id="dti-sim"
            value={dtiDropdown}
            onChange={(e) => onDtiChange(Number(e.target.value) as DropdownDTI)}
            className={INPUT_CLASS}
          >
            <option value={0}>Normal (0%)</option>
            <option value={25}>Turun 25%</option>
            <option value={50}>Turun 50%</option>
          </select>
        </div>

        <div className={`p-4 rounded-xl text-center ${dtiStatus.bg}`}>
          <p className={`text-3xl font-extrabold ${dtiStatus.color}`}>
            {dtiRatio}%
          </p>
          <p className={`text-xs font-bold mt-1 ${dtiStatus.color}`}>
            {dtiStatus.label}
          </p>
        </div>

        <div className="text-xs text-gray-500 space-y-1">
          <div className="flex justify-between">
            <span>Total cicilan aktif / bulan</span>
            <span className="font-bold text-gray-700">
              {formatRupiah(totalCicilanAktif)}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Pemasukan (simulasi)</span>
            <span className="font-bold text-gray-700">
              {formatRupiah(simulasiPemasukan)}
            </span>
          </div>
        </div>
        <p className="text-[10px] text-gray-400">
          DTI di bawah 30% umumnya dianggap sehat, 30–40% perlu waspada, dan di
          atas 40% berisiko.
        </p>
      </div>
    </div>
  );
}

// ==========================================
// SIMULASI PENURUNAN PENDAPATAN TERHADAP CICILAN
// ==========================================
interface HasilSimulasi {
  pendapatanBaru: number;
  totalCicilan: number;
  dtiAwal: number | null;
  dtiBaru: number | null;
  sisaSetelahCicilan: number;
  bulanBertahan: number | null; // null = pendapatan masih cukup
  batasSehat: number | null; // maks. penurunan (%) agar DTI <= 30%
  batasWaspada: number | null; // maks. penurunan (%) agar DTI <= 40%
}

const hitungBatasPenurunan = (
  acuan: number,
  totalCicilan: number,
  targetDti: number,
): number | null => {
  if (acuan <= 0) return null;
  if (totalCicilan <= 0) return 100;
  const pendapatanMinimal = totalCicilan / (targetDti / 100);
  return Math.max(0, (1 - pendapatanMinimal / acuan) * 100);
};

const hitungSimulasi = (
  acuan: number,
  persenTurun: number,
  totalCicilan: number,
  saldo: number,
): HasilSimulasi => {
  const pendapatanBaru = acuan * (1 - persenTurun / 100);
  const sisaSetelahCicilan = pendapatanBaru - totalCicilan;

  let bulanBertahan: number | null = null;
  if (sisaSetelahCicilan < 0) {
    bulanBertahan = saldo > 0 ? saldo / -sisaSetelahCicilan : 0;
  }

  return {
    pendapatanBaru,
    totalCicilan,
    dtiAwal: acuan > 0 ? (totalCicilan / acuan) * 100 : null,
    dtiBaru: pendapatanBaru > 0 ? (totalCicilan / pendapatanBaru) * 100 : null,
    sisaSetelahCicilan,
    bulanBertahan,
    batasSehat: hitungBatasPenurunan(acuan, totalCicilan, 30),
    batasWaspada: hitungBatasPenurunan(acuan, totalCicilan, 40),
  };
};

const formatBatas = (batas: number | null) => {
  if (batas === null) return "-";
  if (batas >= 100) return "tanpa batas";
  return `${Math.floor(batas)}%`;
};

const formatDti = (dti: number | null) =>
  dti === null ? "-" : `${dti.toFixed(1)}%`;

const PRESET_PENURUNAN = [10, 25, 50];

function BarisBandingan({
  label,
  sekarang,
  setelah,
  merah = false,
}: Readonly<{
  label: string;
  sekarang: string;
  setelah: string;
  merah?: boolean;
}>) {
  return (
    <div className="grid grid-cols-3 gap-2 py-2 text-xs border-b border-gray-100 last:border-b-0">
      <span className="text-gray-500">{label}</span>
      <span className="text-right font-bold text-gray-700">{sekarang}</span>
      <span
        className={`text-right font-bold ${
          merah ? "text-rose-600" : "text-gray-700"
        }`}
      >
        {setelah}
      </span>
    </div>
  );
}

interface TabSimulasiProps {
  pemasukan: number;
  saldo: number;
  pinjamanList: Pinjaman[];
  persen: number;
  onPersenChange: (v: number) => void;
  acuanInput: string;
  onAcuanChange: (v: string) => void;
}

function TabSimulasi({
  pemasukan,
  saldo,
  pinjamanList,
  persen,
  onPersenChange,
  acuanInput,
  onAcuanChange,
}: Readonly<TabSimulasiProps>) {
  const acuanManual = Number(acuanInput);
  const acuan = acuanManual > 0 ? acuanManual : pemasukan;
  const pinjamanAktif = pinjamanList.filter((p) => p.status === "aktif");
  const totalCicilan = pinjamanAktif.reduce(
    (acc, p) => acc + p.cicilanPerBulan,
    0,
  );

  const hasil = hitungSimulasi(acuan, persen, totalCicilan, saldo);
  const status = getDtiStatus(hasil.dtiBaru ?? 0);
  const kekurangan = Math.max(-hasil.sisaSetelahCicilan, 0);
  const lebarBar = Math.min(hasil.dtiBaru ?? 0, 100);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800">Simulasi Pendapatan</h2>
        <p className="text-xs text-gray-500 mt-1">
          Lihat dampak turunnya pendapatan terhadap kemampuan membayar cicilan.
        </p>
      </div>

      {/* PENGATURAN */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-4">
        <div>
          <label
            htmlFor="sim-acuan"
            className="block text-xs text-gray-500 mb-1"
          >
            Pendapatan bulanan acuan (Rp)
          </label>
          <input
            id="sim-acuan"
            type="number"
            min={0}
            value={acuanInput}
            onChange={(e) => onAcuanChange(e.target.value)}
            placeholder={`Otomatis dari pemasukan: ${formatRupiah(pemasukan)}`}
            className={INPUT_CLASS}
          />
          <p className="text-[11px] text-gray-400 mt-1">
            Kosongkan untuk memakai total pemasukan yang tercatat.
          </p>
        </div>

        <div>
          <div className="flex justify-between items-center mb-1">
            <label htmlFor="sim-persen" className="text-xs text-gray-500">
              Pendapatan turun
            </label>
            <span className="text-lg font-extrabold text-teal-700">
              {persen}%
            </span>
          </div>
          <input
            id="sim-persen"
            type="range"
            min={0}
            max={90}
            step={5}
            value={persen}
            onChange={(e) => onPersenChange(Number(e.target.value))}
            className="w-full accent-teal-600"
          />
          <div className="flex gap-2 mt-2">
            {PRESET_PENURUNAN.map((nilai) => (
              <button
                key={nilai}
                type="button"
                onClick={() => onPersenChange(nilai)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold ${
                  persen === nilai
                    ? "bg-teal-600 text-white"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {nilai}%
              </button>
            ))}
          </div>
        </div>
      </div>

      {acuan <= 0 && (
        <div className="bg-amber-50 border border-amber-100 p-4 rounded-2xl text-xs text-amber-700">
          Belum ada pendapatan sebagai acuan. Tambahkan transaksi pemasukan,
          atau isi kolom pendapatan acuan di atas.
        </div>
      )}

      {acuan > 0 && totalCicilan <= 0 && (
        <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-2xl text-xs text-emerald-700">
          Belum ada pinjaman aktif, jadi penurunan pendapatan belum membebani
          cicilan. Tambahkan pinjaman di tab Pinjaman untuk melihat simulasinya.
        </div>
      )}

      {acuan > 0 && (
        <>
          {/* HASIL DTI */}
          <div className={`p-5 rounded-2xl text-center ${status.bg}`}>
            <p className="text-[11px] text-gray-500">
              Rasio cicilan terhadap pendapatan setelah turun
            </p>
            <p className={`text-4xl font-extrabold mt-1 ${status.color}`}>
              {formatDti(hasil.dtiBaru)}
            </p>
            <p className={`text-xs font-bold mt-1 ${status.color}`}>
              {status.label}
            </p>
            <div
              className={`relative w-full h-2.5 bg-white/70 rounded-full overflow-hidden mt-4 ${status.color}`}
            >
              <div
                className="h-full bg-current rounded-full transition-all"
                style={{ width: `${lebarBar}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-gray-400 mt-1">
              <span>0%</span>
              <span>30% sehat</span>
              <span>40% bahaya</span>
              <span>100%</span>
            </div>
          </div>

          {/* PERBANDINGAN */}
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
            <div className="grid grid-cols-3 gap-2 pb-2 text-[11px] font-bold text-gray-400 border-b border-gray-100">
              <span></span>
              <span className="text-right">Sekarang</span>
              <span className="text-right">Setelah turun</span>
            </div>
            <BarisBandingan
              label="Pendapatan"
              sekarang={formatRupiah(acuan)}
              setelah={formatRupiah(Math.round(hasil.pendapatanBaru))}
            />
            <BarisBandingan
              label="Cicilan aktif"
              sekarang={formatRupiah(totalCicilan)}
              setelah={formatRupiah(totalCicilan)}
            />
            <BarisBandingan
              label="Rasio cicilan"
              sekarang={formatDti(hasil.dtiAwal)}
              setelah={formatDti(hasil.dtiBaru)}
            />
            <BarisBandingan
              label="Sisa setelah cicilan"
              sekarang={formatRupiah(Math.round(acuan - totalCicilan))}
              setelah={formatRupiah(Math.round(hasil.sisaSetelahCicilan))}
              merah={hasil.sisaSetelahCicilan < 0}
            />
          </div>

          {/* KETAHANAN */}
          {hasil.bulanBertahan === null ? (
            <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-2xl text-xs text-emerald-700">
              Dengan pendapatan turun {persen}%, cicilan masih tertutup dan
              tersisa {formatRupiah(Math.round(hasil.sisaSetelahCicilan))} per
              bulan.
            </div>
          ) : (
            <div className="bg-rose-50 border border-rose-100 p-4 rounded-2xl text-xs text-rose-700 space-y-1">
              <p className="font-bold">
                Pendapatan tidak cukup menutup cicilan.
              </p>
              <p>
                Kekurangan {formatRupiah(Math.round(kekurangan))} per bulan.
                {saldo > 0
                  ? ` Saldo ${formatRupiah(saldo)} hanya bertahan sekitar ${hasil.bulanBertahan.toFixed(1)} bulan.`
                  : " Saldo Anda saat ini tidak mencukupi untuk menutup selisih itu."}
              </p>
            </div>
          )}

          {/* BATAS AMAN */}
          {totalCicilan > 0 && (
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-2">
              <h3 className="font-bold text-gray-800 text-sm">
                Batas penurunan yang masih aman
              </h3>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">
                  Agar rasio tetap ≤ 30% (sehat)
                </span>
                <span className="font-bold text-emerald-600">
                  maks. {formatBatas(hasil.batasSehat)}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">
                  Agar rasio tetap ≤ 40% (batas bahaya)
                </span>
                <span className="font-bold text-amber-600">
                  maks. {formatBatas(hasil.batasWaspada)}
                </span>
              </div>
            </div>
          )}

          {/* RINCIAN PER PINJAMAN */}
          {pinjamanAktif.length > 0 && (
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-3">
              <h3 className="font-bold text-gray-800 text-sm">
                Beban tiap pinjaman setelah pendapatan turun
              </h3>
              {pinjamanAktif.map((p) => {
                const porsi =
                  hasil.pendapatanBaru > 0
                    ? (p.cicilanPerBulan / hasil.pendapatanBaru) * 100
                    : 0;
                return (
                  <div key={p.id} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-bold text-gray-700">{p.nama}</span>
                      <span className="text-gray-500">
                        {formatRupiah(p.cicilanPerBulan)} • {porsi.toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-teal-500 rounded-full"
                        style={{ width: `${Math.min(porsi, 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <p className="text-[10px] text-gray-400">
        Simulasi ini hanya perkiraan berdasarkan cicilan aktif dan pendapatan
        acuan, bukan nasihat keuangan.
      </p>
    </div>
  );
}

// ==========================================
// KOMPONEN: NAVIGASI BAWAH
// ==========================================
interface NavBawahProps {
  activeTab: TabType;
  onChange: (t: TabType) => void;
}

function NavBawah({ activeTab, onChange }: Readonly<NavBawahProps>) {
  return (
    <nav className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-100 flex justify-around py-2 z-10">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.key}
          onClick={() => onChange(item.key)}
          aria-label={item.label}
          className={`flex flex-col items-center px-2 py-1 text-[10px] font-bold transition-colors ${
            activeTab === item.key ? "text-teal-600" : "text-gray-400"
          }`}
        >
          <span className="text-xl">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </nav>
  );
}

// ==========================================
// KOMPONEN: MODAL
// ==========================================
interface ModalProps {
  onSubmit: (e: React.SyntheticEvent<HTMLFormElement>) => void;
  onTutup: () => void;
}

function TombolModal({ onTutup }: Readonly<{ onTutup: () => void }>) {
  return (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={onTutup}
        className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-600 font-bold text-sm"
      >
        Batal
      </button>
      <button
        type="submit"
        className="flex-1 py-3 rounded-xl bg-teal-600 text-white font-bold text-sm"
      >
        Simpan
      </button>
    </div>
  );
}

function ModalTambahTransaksi({ onSubmit, onTutup }: Readonly<ModalProps>) {
  return (
    <div className="absolute inset-0 bg-black/50 z-20 flex items-end">
      <form
        onSubmit={onSubmit}
        aria-label="Form Tambah Transaksi"
        className="bg-white w-full rounded-t-3xl p-6 space-y-4"
      >
        <h3 className="text-lg font-bold text-gray-800">Tambah Transaksi</h3>
        <select
          name="tipe"
          aria-label="Tipe transaksi"
          defaultValue="pemasukan"
          className={INPUT_CLASS}
        >
          <option value="pemasukan">Pemasukan</option>
          <option value="pengeluaran">Pengeluaran</option>
        </select>
        <input
          name="judul"
          required
          placeholder="Judul (mis. Gaji)"
          aria-label="Judul"
          className={INPUT_CLASS}
        />
        <input
          name="kategori"
          required
          placeholder="Kategori (mis. Pekerjaan)"
          aria-label="Kategori"
          className={INPUT_CLASS}
        />
        <input
          name="nominal"
          type="number"
          min={1}
          required
          placeholder="Nominal (Rp)"
          aria-label="Nominal"
          className={INPUT_CLASS}
        />
        <TombolModal onTutup={onTutup} />
      </form>
    </div>
  );
}

function ModalTambahPinjaman({ onSubmit, onTutup }: Readonly<ModalProps>) {
  return (
    <div className="absolute inset-0 bg-black/50 z-20 flex items-end">
      <form
        onSubmit={onSubmit}
        aria-label="Form Tambah Pinjaman"
        className="bg-white w-full rounded-t-3xl p-6 space-y-4"
      >
        <h3 className="text-lg font-bold text-gray-800">Pinjaman Baru</h3>
        <input
          name="nama"
          required
          placeholder="Nama pinjaman (mis. KPR)"
          aria-label="Nama pinjaman"
          className={INPUT_CLASS}
        />
        <input
          name="nominal"
          type="number"
          min={1}
          required
          placeholder="Total utang (Rp)"
          aria-label="Total utang"
          className={INPUT_CLASS}
        />
        <input
          name="cicilan"
          type="number"
          min={1}
          required
          placeholder="Cicilan per bulan (Rp)"
          aria-label="Cicilan per bulan"
          className={INPUT_CLASS}
        />
        <TombolModal onTutup={onTutup} />
      </form>
    </div>
  );
}

// ==========================================
// MAIN APP COMPONENT
// ==========================================
function Dashboard({
  akun,
  onLogout,
}: Readonly<{ akun: Akun; onLogout: () => void }>) {
  // 1. DATA TERSIMPAN (dibaca sekali saat dashboard dibuka)
  const [awal] = useState(() => bacaDataAkun(akun.id));

  // 2. DASHBOARD STATE
  const [activeTab, setActiveTab] = useState<TabType>("ringkasan");
  const [saldo, setSaldo] = useState(awal?.saldo ?? 0);
  const [pemasukan, setPemasukan] = useState(awal?.pemasukan ?? 0);
  const [pengeluaran, setPengeluaran] = useState(awal?.pengeluaran ?? 0);

  // 3. TRANSAKSI & PINJAMAN STATE
  const [transaksiList, setTransaksiList] = useState<Transaksi[]>(
    awal?.transaksiList ?? [],
  );
  const [showAddTrxModal, setShowAddTrxModal] = useState(false);
  const [pinjamanList, setPinjamanList] = useState<Pinjaman[]>(
    awal?.pinjamanList ?? [],
  );
  const [showAddPinjamanModal, setShowAddPinjamanModal] = useState(false);

  // 4. LAPORAN/DTI STATE
  const [dtiDropdown, setDtiDropdown] = useState<DropdownDTI>(0);

  // 5. SIMULASI PENURUNAN PENDAPATAN
  const [simPersen, setSimPersen] = useState(20);
  const [simAcuanInput, setSimAcuanInput] = useState("");

  // Simpan data otomatis setiap ada perubahan
  useEffect(() => {
    simpanDataAkun(akun.id, {
      saldo,
      pemasukan,
      pengeluaran,
      transaksiList,
      pinjamanList,
    });
  }, [akun.id, saldo, pemasukan, pengeluaran, transaksiList, pinjamanList]);

  // --- TRANSAKSI & PINJAMAN ---
  const handleTambahTransaksi = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const tipe = formData.get("tipe") as TipeTransaksi;
    const nominal = Number(formData.get("nominal"));
    const judul = formData.get("judul") as string;
    const kategori = formData.get("kategori") as string;

    if (!nominal || nominal <= 0) return;

    if (tipe === "pemasukan") {
      setSaldo((prev) => prev + nominal);
      setPemasukan((prev) => prev + nominal);
    } else {
      setSaldo((prev) => prev - nominal);
      setPengeluaran((prev) => prev + nominal);
    }

    setTransaksiList((prev) => [
      {
        id: generateId(),
        judul,
        kategori,
        tipe,
        nominal,
        tanggal: new Date().toISOString(),
      },
      ...prev,
    ]);

    setShowAddTrxModal(false);
  };

  const handleTambahPinjaman = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const nominal = Number(formData.get("nominal"));
    const cicilan = Number(formData.get("cicilan"));

    if (!nominal || nominal <= 0 || !cicilan || cicilan <= 0) return;

    const newPinjaman: Pinjaman = {
      id: generateId(),
      nama: formData.get("nama") as string,
      totalUtang: nominal,
      sisaUtang: nominal,
      cicilanPerBulan: cicilan,
      jatuhTempo: "15 Nov 2026",
      status: "aktif",
    };
    setPinjamanList((prev) => [newPinjaman, ...prev]);
    setShowAddPinjamanModal(false);
  };

  const handleBayarCicilan = (pinjamanId: number, nominalCicilan: number) => {
    const target = pinjamanList.find((p) => p.id === pinjamanId);
    if (!target) return;

    // Jangan bayar lebih dari sisa utang
    const bayar = Math.min(nominalCicilan, target.sisaUtang);

    if (saldo < bayar) {
      alert("Saldo tidak cukup untuk membayar cicilan ini!");
      return;
    }

    setSaldo((prev) => prev - bayar);
    setPengeluaran((prev) => prev + bayar);

    setTransaksiList((prev) => [
      {
        id: generateId(),
        judul: `Bayar Cicilan ${target.nama}`,
        kategori: "Tagihan",
        tipe: "pengeluaran",
        nominal: bayar,
        tanggal: new Date().toISOString(),
      },
      ...prev,
    ]);

    setPinjamanList((prev) =>
      perbaruiPinjamanSetelahBayar(prev, pinjamanId, bayar),
    );
  };

  // --- KALKULASI DYNAMIC ---
  const totalCicilanAktif = pinjamanList
    .filter((p) => p.status === "aktif")
    .reduce((acc, curr) => acc + curr.cicilanPerBulan, 0);
  const simulasiPemasukan = pemasukan * (1 - dtiDropdown / 100);
  const dtiNumber =
    simulasiPemasukan > 0 ? (totalCicilanAktif / simulasiPemasukan) * 100 : 0;
  const dtiRatio = dtiNumber.toFixed(1);
  const dtiStatus = getDtiStatus(dtiNumber);
  const persentaseAnggaran = Math.min(
    (pengeluaran / BATAS_ANGGARAN) * 100,
    100,
  ).toFixed(0);

  // ==========================================
  // RENDER
  // ==========================================
  const tampilkanSaldo = activeTab === "ringkasan" || activeTab === "transaksi";

  return (
    <div className="flex flex-col h-screen w-full max-w-md mx-auto bg-gray-50 text-gray-800 shadow-2xl relative overflow-hidden font-sans">
      <HeaderUtama
        nama={akun.nama}
        onLogout={onLogout}
        onTambah={() => setShowAddTrxModal(true)}
      />

      <main className="flex-1 overflow-y-auto p-5 pb-28 space-y-6">
        {tampilkanSaldo && (
          <div className="space-y-6">
            <KartuSaldo
              saldo={saldo}
              pemasukan={pemasukan}
              pengeluaran={pengeluaran}
            />
            <DaftarTransaksi transaksiList={transaksiList} />
          </div>
        )}

        {activeTab === "pinjaman" && (
          <TabPinjaman
            pinjamanList={pinjamanList}
            onTambah={() => setShowAddPinjamanModal(true)}
            onBayar={handleBayarCicilan}
          />
        )}

        {activeTab === "laporan" && (
          <TabLaporan
            pengeluaran={pengeluaran}
            persentaseAnggaran={persentaseAnggaran}
            dtiDropdown={dtiDropdown}
            onDtiChange={setDtiDropdown}
            dtiRatio={dtiRatio}
            dtiStatus={dtiStatus}
            totalCicilanAktif={totalCicilanAktif}
            simulasiPemasukan={simulasiPemasukan}
          />
        )}
        {activeTab === "simulasi" && (
          <TabSimulasi
            pemasukan={pemasukan}
            saldo={saldo}
            pinjamanList={pinjamanList}
            persen={simPersen}
            onPersenChange={setSimPersen}
            acuanInput={simAcuanInput}
            onAcuanChange={setSimAcuanInput}
          />
        )}
      </main>

      <NavBawah activeTab={activeTab} onChange={setActiveTab} />

      {showAddTrxModal && (
        <ModalTambahTransaksi
          onSubmit={handleTambahTransaksi}
          onTutup={() => setShowAddTrxModal(false)}
        />
      )}

      {showAddPinjamanModal && (
        <ModalTambahPinjaman
          onSubmit={handleTambahPinjaman}
          onTutup={() => setShowAddPinjamanModal(false)}
        />
      )}
    </div>
  );
}

// ==========================================
// KOMPONEN UTAMA: pilih layar login atau dashboard
// ==========================================
export default function LunasinApp() {
  const sesiId = useSyncExternalStore(
    subscribeSesi,
    getSesiIdClient,
    getSesiIdServer,
  );

  if (sesiId === undefined) return <LayarMemuat />;

  const akun = sesiId ? getSesi() : null;
  if (!akun) return <LayarAuth />;

  return <Dashboard key={akun.id} akun={akun} onLogout={keluar} />;
}
