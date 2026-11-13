"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";

// ==========================================
// TYPES
// ==========================================
type TipeTransaksi = "pemasukan" | "pengeluaran";
type DropdownDTI = 0 | 25 | 50;
type PinjamanView = "daftar" | "portofolio";
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
  bungaPersen: number; // bunga per tahun (%)
  tanggalJatuhTempo: number; // tanggal tagihan tiap bulan (1-31)
  bulanTagihan: string; // bulan tagihan berikutnya, format "YYYY-MM"
  kaliDibayar: number;
  bungaTerbayar: number;
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

const normalisasiData = (data: DataAkun): DataAkun => ({
  saldo: data.saldo ?? 0,
  pemasukan: data.pemasukan ?? 0,
  pengeluaran: data.pengeluaran ?? 0,
  transaksiList: data.transaksiList ?? [],
  pinjamanList: (data.pinjamanList ?? []).map(sesuaikanPinjaman),
});

const getDtiStatus = (dti: number): DtiStatus => {
  if (dti > 40) {
    return { label: "Berbahaya", color: "text-rose-600", bg: "bg-rose-50" };
  }
  if (dti > 30) {
    return { label: "Waspada", color: "text-amber-600", bg: "bg-amber-50" };
  }
  return { label: "Sehat", color: "text-emerald-600", bg: "bg-emerald-50" };
};

// --- Tanggal & bulan ---
const kunciBulan = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const tambahBulan = (kunci: string, n: number) => {
  const [tahun, bulan] = kunci.split("-").map(Number);
  return kunciBulan(new Date(tahun, bulan - 1 + n, 1));
};

const buatTanggal = (tahun: number, bulan0: number, hari: number) => {
  const hariTerakhir = new Date(tahun, bulan0 + 1, 0).getDate();
  return new Date(tahun, bulan0, Math.min(hari, hariTerakhir));
};

const tanggalDariKunci = (kunci: string, hari: number) => {
  const [tahun, bulan] = kunci.split("-").map(Number);
  return buatTanggal(tahun, bulan - 1, hari);
};

const formatTanggalPendek = (d: Date) =>
  d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });

const formatBulanTahun = (d: Date) =>
  d.toLocaleDateString("id-ID", { month: "long", year: "numeric" });

// --- Pinjaman: bunga, tagihan, estimasi ---
const sesuaikanPinjaman = (p: Pinjaman): Pinjaman => ({
  ...p,
  bungaPersen: p.bungaPersen ?? 0,
  tanggalJatuhTempo: p.tanggalJatuhTempo ?? 15,
  bulanTagihan: p.bulanTagihan ?? kunciBulan(new Date()),
  kaliDibayar: p.kaliDibayar ?? 0,
  bungaTerbayar: p.bungaTerbayar ?? 0,
});

// Bunga bulanan dari bunga tahunan (sistem bunga menurun / efektif)
const bungaBulanan = (sisa: number, bungaPersen: number) =>
  Math.round((sisa * bungaPersen) / 1200);

// Nominal yang harus dibayar bulan ini (cicilan terakhir bisa lebih kecil)
const hitungTagihan = (p: Pinjaman) =>
  Math.min(
    p.cicilanPerBulan,
    p.sisaUtang + bungaBulanan(p.sisaUtang, p.bungaPersen),
  );

interface EstimasiUtang {
  kaliBayarLagi: number | null; // null = tidak akan lunas
  totalBungaKedepan: number;
  totalBayarKedepan: number;
  tanggalLunas: Date | null;
}

const hitungEstimasiUtang = (p: Pinjaman): EstimasiUtang => {
  let sisa = p.sisaUtang;
  let kali = 0;
  let totalBunga = 0;
  let totalBayar = 0;

  while (sisa > 0 && kali < 600) {
    const bunga = bungaBulanan(sisa, p.bungaPersen);
    if (p.cicilanPerBulan <= bunga) break; // cicilan tidak menutup bunga
    const bayar = Math.min(p.cicilanPerBulan, sisa + bunga);
    sisa = sisa + bunga - bayar;
    totalBunga += bunga;
    totalBayar += bayar;
    kali += 1;
  }

  if (sisa > 0) {
    return {
      kaliBayarLagi: null,
      totalBungaKedepan: totalBunga,
      totalBayarKedepan: totalBayar,
      tanggalLunas: null,
    };
  }

  return {
    kaliBayarLagi: kali,
    totalBungaKedepan: totalBunga,
    totalBayarKedepan: totalBayar,
    tanggalLunas:
      kali > 0
        ? tanggalDariKunci(
            tambahBulan(p.bulanTagihan, kali - 1),
            p.tanggalJatuhTempo,
          )
        : null,
  };
};

// --- Tenggat / notifikasi ---
type TingkatTenggat = "terlambat" | "hariIni" | "segera" | "aman";

interface InfoTenggat {
  tanggal: Date;
  selisihHari: number;
  tingkat: TingkatTenggat;
}

const hitungTenggat = (p: Pinjaman, hariIni: Date): InfoTenggat => {
  const tanggal = tanggalDariKunci(p.bulanTagihan, p.tanggalJatuhTempo);
  const awalHari = new Date(
    hariIni.getFullYear(),
    hariIni.getMonth(),
    hariIni.getDate(),
  );
  const selisihHari = Math.round(
    (tanggal.getTime() - awalHari.getTime()) / 86400000,
  );

  let tingkat: TingkatTenggat = "aman";
  if (selisihHari < 0) tingkat = "terlambat";
  else if (selisihHari === 0) tingkat = "hariIni";
  else if (selisihHari <= 3) tingkat = "segera";

  return { tanggal, selisihHari, tingkat };
};

const teksTenggat = (t: InfoTenggat) => {
  const tgl = formatTanggalPendek(t.tanggal);
  if (t.tingkat === "terlambat") {
    return `Terlambat ${Math.abs(t.selisihHari)} hari (jatuh tempo ${tgl})`;
  }
  if (t.tingkat === "hariIni") return "Jatuh tempo hari ini";
  return `Jatuh tempo ${tgl} (${t.selisihHari} hari lagi)`;
};

// Perbarui pinjaman setelah bayar: sebagian cicilan untuk bunga, sisanya pokok
const perbaruiPinjamanSetelahBayar = (
  list: Pinjaman[],
  pinjamanId: number,
  bayar: number,
): Pinjaman[] =>
  list.map((p) => {
    if (p.id !== pinjamanId) return p;
    const bunga = Math.min(bungaBulanan(p.sisaUtang, p.bungaPersen), bayar);
    const pokok = bayar - bunga;
    const sisaBaru = Math.max(p.sisaUtang - pokok, 0);
    return {
      ...p,
      sisaUtang: sisaBaru,
      kaliDibayar: p.kaliDibayar + 1,
      bungaTerbayar: p.bungaTerbayar + bunga,
      bulanTagihan: tambahBulan(p.bulanTagihan, 1),
      status: sisaBaru <= 0 ? "lunas" : "aktif",
    };
  });

// ==========================================
// SUPABASE: LOGIN & PENYIMPANAN DATA DI SERVER
// ==========================================
interface Akun {
  id: string;
  email: string;
  nama: string;
}

type Hasil = { ok: true; info?: string } | { ok: false; pesan: string };

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";
const SUPABASE_SIAP = Boolean(SUPABASE_URL && SUPABASE_KEY);

let klienSupabase: SupabaseClient | null = null;
const getSupabase = (): SupabaseClient => {
  klienSupabase ??= createClient(SUPABASE_URL, SUPABASE_KEY);
  return klienSupabase;
};

const AUTH_INPUT_CLASS =
  "w-full p-4 bg-gray-50 border border-gray-300 rounded-xl text-sm text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-teal-500 outline-none transition-all";

const getLabelTombolAuth = (loading: boolean, isDaftar: boolean) => {
  if (loading) return "Memproses...";
  if (isDaftar) return "Daftar";
  return "Masuk Sekarang";
};

const userKeAkun = (user: User): Akun => {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const nama = [meta.nama, meta.full_name, meta.name].find(
    (v): v is string => typeof v === "string" && v.trim() !== "",
  );
  return {
    id: user.id,
    email: user.email ?? "",
    nama: nama ?? user.email ?? "Pengguna",
  };
};

const terjemahkanError = (pesan: string) => {
  const p = pesan.toLowerCase();
  if (p.includes("invalid login credentials")) {
    return "Email atau kata sandi salah!";
  }
  if (p.includes("email not confirmed")) {
    return "Email belum diverifikasi. Cek kotak masuk Anda.";
  }
  if (p.includes("already registered")) {
    return "Email ini sudah terdaftar. Silakan masuk.";
  }
  if (p.includes("at least")) return "Kata sandi minimal 6 karakter.";
  if (p.includes("rate limit")) {
    return "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.";
  }
  if (
    p.includes("provider is not enabled") ||
    p.includes("unsupported provider")
  ) {
    return "Login Google belum diaktifkan di Supabase.";
  }
  return pesan;
};

async function daftarAkun(
  nama: string,
  email: string,
  password: string,
): Promise<Hasil> {
  const { data, error } = await getSupabase().auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: { nama: nama.trim() },
      emailRedirectTo: window.location.origin,
    },
  });
  if (error) return { ok: false, pesan: terjemahkanError(error.message) };

  // Supabase mengembalikan identities kosong jika email sudah terdaftar
  if (data.user?.identities?.length === 0) {
    return { ok: false, pesan: "Email ini sudah terdaftar. Silakan masuk." };
  }
  if (!data.session) {
    return {
      ok: true,
      info: `Kami mengirim tautan verifikasi ke ${email.trim()}. Klik tautan itu, lalu masuk.`,
    };
  }
  return { ok: true };
}

async function masukAkun(email: string, password: string): Promise<Hasil> {
  const { error } = await getSupabase().auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) return { ok: false, pesan: terjemahkanError(error.message) };
  return { ok: true };
}

async function masukGoogle(): Promise<Hasil> {
  const { error } = await getSupabase().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
  if (error) return { ok: false, pesan: terjemahkanError(error.message) };
  return { ok: true };
}

async function keluarAkun() {
  await getSupabase().auth.signOut();
}

// --- Data keuangan: satu baris per akun di tabel data_akun ---
async function muatDataServer(userId: string): Promise<DataAkun | null> {
  const { data, error } = await getSupabase()
    .from("data_akun")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.data ? normalisasiData(data.data as DataAkun) : null;
}

async function simpanDataServer(userId: string, data: DataAkun) {
  const { error } = await getSupabase()
    .from("data_akun")
    .upsert({ user_id: userId, data, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

// --- Sesi login (undefined = sedang memuat, null = belum masuk) ---
type Sesi = Akun | null | undefined;

function useSesi(): Sesi {
  const [sesi, setSesi] = useState<Sesi>(SUPABASE_SIAP ? undefined : null);

  useEffect(() => {
    if (!SUPABASE_SIAP) return;
    const { data } = getSupabase().auth.onAuthStateChange((_event, session) => {
      setSesi((prev) => {
        if (!session?.user) return null;
        return prev?.id === session.user.id ? prev : userKeAkun(session.user);
      });
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return sesi;
}

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
function IkonGoogle() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function LayarAuth() {
  const [isDaftar, setIsDaftar] = useState(false);
  const [nama, setNama] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    try {
      const hasil = isDaftar
        ? await daftarAkun(nama, email, password)
        : await masukAkun(email, password);

      if (!hasil.ok) {
        setError(hasil.pesan);
        return;
      }
      // Jika langsung berhasil masuk, layar otomatis berganti ke dashboard
      if (hasil.info) {
        setInfo(hasil.info);
        setIsDaftar(false);
        setPassword("");
      }
    } catch {
      setError("Gagal terhubung ke server. Periksa koneksi internet Anda.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError("");
    setInfo("");
    setLoading(true);
    try {
      const hasil = await masukGoogle();
      if (!hasil.ok) {
        setError(hasil.pesan);
        setLoading(false);
      }
      // Jika berhasil, browser dialihkan ke halaman login Google
    } catch {
      setError("Gagal terhubung ke server. Periksa koneksi internet Anda.");
      setLoading(false);
    }
  };

  const handleToggle = () => {
    setError("");
    setInfo("");
    setIsDaftar((prev) => !prev);
  };

  return (
    <div className="flex min-h-screen max-w-md mx-auto bg-teal-900 justify-center items-center p-6 text-white font-sans">
      <form
        onSubmit={handleSubmit}
        className="bg-white p-8 rounded-3xl shadow-2xl w-full text-gray-800 space-y-5"
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
              ? "Daftar dengan email. Data Anda tersimpan dan bisa dibuka di perangkat mana pun."
              : "Masuk untuk memonitor keuangan Anda"}
          </p>
        </div>

        {!SUPABASE_SIAP && (
          <p className="bg-amber-50 border border-amber-100 text-amber-700 text-xs p-3 rounded-xl">
            Server data belum dikonfigurasi. Isi NEXT_PUBLIC_SUPABASE_URL dan
            NEXT_PUBLIC_SUPABASE_ANON_KEY di .env.local (dan di Vercel), lalu
            jalankan ulang.
          </p>
        )}

        {error && (
          <p className="text-red-500 text-xs text-center font-bold">{error}</p>
        )}
        {info && (
          <p className="text-teal-700 text-xs text-center font-bold">{info}</p>
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
            type="email"
            placeholder="Email"
            required
            autoComplete="email"
            aria-label="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={AUTH_INPUT_CLASS}
          />
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
          disabled={loading || !SUPABASE_SIAP}
          className="w-full bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white font-bold py-4 rounded-xl shadow-lg transition-all active:scale-95"
        >
          {getLabelTombolAuth(loading, isDaftar)}
        </button>

        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span className="flex-1 h-px bg-gray-200" />
          <span>atau</span>
          <span className="flex-1 h-px bg-gray-200" />
        </div>

        <button
          type="button"
          onClick={handleGoogle}
          disabled={loading || !SUPABASE_SIAP}
          className="w-full flex items-center justify-center gap-3 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-60 text-gray-700 font-bold py-3 rounded-xl transition-all active:scale-95"
        >
          <IkonGoogle />
          Lanjutkan dengan Google
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

type StatusSimpan = "tersimpan" | "menyimpan" | "gagal";

const LABEL_STATUS: Record<StatusSimpan, { teks: string; warna: string }> = {
  tersimpan: { teks: "☁️ Tersimpan", warna: "text-emerald-600" },
  menyimpan: { teks: "Menyimpan...", warna: "text-gray-400" },
  gagal: { teks: "⚠️ Gagal menyimpan", warna: "text-rose-600" },
};

// ==========================================
// KOMPONEN: HEADER
// ==========================================
interface HeaderUtamaProps {
  nama: string;
  status: StatusSimpan;
  onLogout: () => void;
  onTambah: () => void;
}

function HeaderUtama({
  nama,
  status,
  onLogout,
  onTambah,
}: Readonly<HeaderUtamaProps>) {
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
            </button>{" "}
            •{" "}
            <span className={LABEL_STATUS[status].warna}>
              {LABEL_STATUS[status].teks}
            </span>
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
// KOMPONEN: PINJAMAN, PORTOFOLIO, NOTIFIKASI
// ==========================================
const WARNA_TENGGAT: Record<
  TingkatTenggat,
  { kotak: string; teks: string; ikon: string }
> = {
  terlambat: {
    kotak: "bg-rose-50 border-rose-100",
    teks: "text-rose-600",
    ikon: "🔴",
  },
  hariIni: {
    kotak: "bg-amber-50 border-amber-100",
    teks: "text-amber-700",
    ikon: "🟠",
  },
  segera: {
    kotak: "bg-amber-50 border-amber-100",
    teks: "text-amber-700",
    ikon: "🟡",
  },
  aman: {
    kotak: "bg-gray-50 border-gray-100",
    teks: "text-gray-600",
    ikon: "🔔",
  },
};

function StatKecil({
  label,
  nilai,
  warna = "text-gray-800",
}: Readonly<{ label: string; nilai: string; warna?: string }>) {
  return (
    <div className="bg-gray-50 rounded-xl p-3">
      <p className="text-[10px] text-gray-400">{label}</p>
      <p className={`text-xs font-bold mt-0.5 ${warna}`}>{nilai}</p>
    </div>
  );
}

interface ItemPinjamanProps {
  pinjaman: Pinjaman;
  sekarang: Date;
  onBayar: (id: number) => void;
}

function ItemPinjaman({
  pinjaman,
  sekarang,
  onBayar,
}: Readonly<ItemPinjamanProps>) {
  const isAktif = pinjaman.status === "aktif";
  const estimasi = hitungEstimasiUtang(pinjaman);
  const tenggat = hitungTenggat(pinjaman, sekarang);
  const warna = WARNA_TENGGAT[tenggat.tingkat];
  const tagihan = hitungTagihan(pinjaman);
  const tidakLunas = isAktif && estimasi.kaliBayarLagi === null;
  const persenLunas =
    pinjaman.totalUtang > 0
      ? ((pinjaman.totalUtang - pinjaman.sisaUtang) / pinjaman.totalUtang) * 100
      : 0;

  return (
    <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-4">
      <div className="flex justify-between items-start">
        <div>
          <h3 className="font-bold text-gray-800">{pinjaman.nama}</h3>
          <p className="text-[11px] text-gray-500 mt-1">
            Sisa: {formatRupiah(pinjaman.sisaUtang)} dari{" "}
            {formatRupiah(pinjaman.totalUtang)}
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

      <div className="space-y-1">
        <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-teal-500 rounded-full transition-all"
            style={{ width: `${Math.min(persenLunas, 100)}%` }}
          />
        </div>
        <p className="text-[10px] text-gray-400">
          {persenLunas.toFixed(0)}% pokok sudah terbayar • dibayar{" "}
          {pinjaman.kaliDibayar} kali • bunga terbayar{" "}
          {formatRupiah(pinjaman.bungaTerbayar)}
        </p>
      </div>

      {isAktif && !tidakLunas && (
        <div className="grid grid-cols-2 gap-2">
          <StatKecil
            label="Sisa pembayaran"
            nilai={`${estimasi.kaliBayarLagi} kali lagi`}
          />
          <StatKecil
            label="Estimasi lunas"
            nilai={
              estimasi.tanggalLunas
                ? formatBulanTahun(estimasi.tanggalLunas)
                : "-"
            }
          />
          <StatKecil
            label="Bunga"
            nilai={
              pinjaman.bungaPersen > 0
                ? `${pinjaman.bungaPersen}% / tahun`
                : "Tanpa bunga"
            }
          />
          <StatKecil
            label="Cicilan / bulan"
            nilai={formatRupiah(pinjaman.cicilanPerBulan)}
          />
          <StatKecil
            label="Bunga ke depan"
            nilai={formatRupiah(estimasi.totalBungaKedepan)}
            warna="text-rose-600"
          />
          <StatKecil
            label="Total bayar ke depan"
            nilai={formatRupiah(estimasi.totalBayarKedepan)}
          />
        </div>
      )}

      {tidakLunas && (
        <div className="bg-rose-50 border border-rose-100 p-3 rounded-xl text-[11px] text-rose-700">
          Cicilan {formatRupiah(pinjaman.cicilanPerBulan)} tidak cukup menutup
          bunga bulanan (
          {formatRupiah(bungaBulanan(pinjaman.sisaUtang, pinjaman.bungaPersen))}
          ), sehingga utang tidak akan lunas. Naikkan nominal cicilan.
        </div>
      )}

      {isAktif && (
        <div
          className={`border p-2.5 rounded-xl flex items-center justify-between gap-2 ${warna.kotak}`}
        >
          <div className={`flex items-center gap-2 ${warna.teks}`}>
            <span className="text-lg">{warna.ikon}</span>
            <span className="text-[11px] font-bold">
              {teksTenggat(tenggat)}
            </span>
          </div>
          <button
            onClick={() => onBayar(pinjaman.id)}
            className="bg-teal-600 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg shadow-sm active:scale-95 whitespace-nowrap"
          >
            Bayar {formatRupiah(tagihan)}
          </button>
        </div>
      )}
    </div>
  );
}

interface PortofolioProps {
  pinjamanList: Pinjaman[];
  pemasukan: number;
}

function PortofolioUtang({
  pinjamanList,
  pemasukan,
}: Readonly<PortofolioProps>) {
  if (pinjamanList.length === 0) {
    return (
      <div className="bg-white p-6 rounded-2xl border border-dashed border-gray-300 text-center text-gray-400 text-sm">
        Portofolio masih kosong. Tambahkan pinjaman untuk melihat gambaran
        seluruh utang Anda.
      </div>
    );
  }

  const aktif = pinjamanList.filter((p) => p.status === "aktif");
  const jumlahLunas = pinjamanList.length - aktif.length;
  const totalAwal = pinjamanList.reduce((a, p) => a + p.totalUtang, 0);
  const sisaTotal = aktif.reduce((a, p) => a + p.sisaUtang, 0);
  const pokokTerbayar = pinjamanList.reduce(
    (a, p) => a + (p.totalUtang - p.sisaUtang),
    0,
  );
  const bungaTerbayar = pinjamanList.reduce((a, p) => a + p.bungaTerbayar, 0);
  const cicilanBulanan = aktif.reduce((a, p) => a + p.cicilanPerBulan, 0);
  const persenLunas = totalAwal > 0 ? (pokokTerbayar / totalAwal) * 100 : 0;

  const baris = aktif.map((p) => ({ p, e: hitungEstimasiUtang(p) }));
  const bungaKedepan = baris.reduce((a, x) => a + x.e.totalBungaKedepan, 0);
  const adaTakLunas = baris.some((x) => x.e.kaliBayarLagi === null);

  let bebasUtang = "Belum bisa dihitung";
  if (aktif.length === 0) {
    bebasUtang = "Sudah bebas utang 🎉";
  } else if (!adaTakLunas) {
    const terakhir = baris.reduce<Date | null>((maks, x) => {
      const tgl = x.e.tanggalLunas;
      if (!tgl) return maks;
      return !maks || tgl > maks ? tgl : maks;
    }, null);
    bebasUtang = terakhir ? formatBulanTahun(terakhir) : "-";
  }

  const dti = pemasukan > 0 ? (cicilanBulanan / pemasukan) * 100 : null;
  const statusDti = getDtiStatus(dti ?? 0);
  const bungaTertinggi = aktif
    .filter((p) => p.bungaPersen > 0)
    .sort((a, b) => b.bungaPersen - a.bungaPersen)[0];

  return (
    <div className="space-y-5">
      <div className="bg-teal-800 rounded-3xl p-6 text-white shadow-xl">
        <p className="text-xs text-teal-200/80 mb-1">Total sisa utang</p>
        <h2 className="text-3xl font-extrabold tracking-tight">
          {formatRupiah(sisaTotal)}
        </h2>
        <div className="w-full h-2.5 bg-teal-950/50 rounded-full overflow-hidden mt-4">
          <div
            className="h-full bg-teal-300 rounded-full transition-all"
            style={{ width: `${Math.min(persenLunas, 100)}%` }}
          />
        </div>
        <p className="text-[11px] text-teal-200 mt-2">
          {persenLunas.toFixed(1)}% dari total pinjaman{" "}
          {formatRupiah(totalAwal)} sudah terbayar
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StatKecil
          label="Pinjaman aktif / lunas"
          nilai={`${aktif.length} / ${jumlahLunas}`}
        />
        <StatKecil
          label="Cicilan per bulan"
          nilai={formatRupiah(cicilanBulanan)}
        />
        <StatKecil label="Perkiraan bebas utang" nilai={bebasUtang} />
        <StatKecil
          label="Rasio cicilan / pemasukan"
          nilai={dti === null ? "-" : `${dti.toFixed(1)}% (${statusDti.label})`}
          warna={statusDti.color}
        />
        <StatKecil
          label="Bunga sudah dibayar"
          nilai={formatRupiah(bungaTerbayar)}
        />
        <StatKecil
          label="Bunga yang akan datang"
          nilai={formatRupiah(bungaKedepan)}
          warna="text-rose-600"
        />
      </div>

      {bungaTertinggi && (
        <div className="bg-amber-50 border border-amber-100 p-3 rounded-xl text-[11px] text-amber-700">
          Bunga tertinggi: <b>{bungaTertinggi.nama}</b> (
          {bungaTertinggi.bungaPersen}% / tahun). Melunasi pinjaman ini lebih
          dulu biasanya menghemat bunga paling banyak.
        </div>
      )}

      {adaTakLunas && (
        <div className="bg-rose-50 border border-rose-100 p-3 rounded-xl text-[11px] text-rose-700">
          Ada pinjaman yang cicilannya tidak menutup bunga, sehingga tidak akan
          lunas. Cek daftar pinjaman.
        </div>
      )}

      {aktif.length > 0 && (
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-4">
          <h3 className="font-bold text-gray-800 text-sm">
            Rincian tiap pinjaman aktif
          </h3>
          {baris.map(({ p, e }) => {
            const porsi = sisaTotal > 0 ? (p.sisaUtang / sisaTotal) * 100 : 0;
            return (
              <div key={p.id} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-bold text-gray-700">{p.nama}</span>
                  <span className="text-gray-500">
                    {formatRupiah(p.sisaUtang)} • {porsi.toFixed(0)}%
                  </span>
                </div>
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-teal-500 rounded-full"
                    style={{ width: `${porsi}%` }}
                  />
                </div>
                <p className="text-[10px] text-gray-400">
                  {p.bungaPersen > 0
                    ? `Bunga ${p.bungaPersen}%/thn`
                    : "Tanpa bunga"}{" "}
                  •{" "}
                  {e.kaliBayarLagi === null
                    ? "tidak akan lunas"
                    : `${e.kaliBayarLagi} kali lagi`}{" "}
                  • tagihan tiap tanggal {p.tanggalJatuhTempo}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface TabPinjamanProps {
  pinjamanList: Pinjaman[];
  pemasukan: number;
  sekarang: Date;
  view: PinjamanView;
  onViewChange: (v: PinjamanView) => void;
  onTambah: () => void;
  onBayar: (id: number) => void;
}

function TabPinjaman({
  pinjamanList,
  pemasukan,
  sekarang,
  view,
  onViewChange,
  onTambah,
  onBayar,
}: Readonly<TabPinjamanProps>) {
  const pilihan: { key: PinjamanView; label: string }[] = [
    { key: "daftar", label: "Daftar" },
    { key: "portofolio", label: "Portofolio" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-end">
        <h2 className="text-xl font-bold text-gray-800">Pinjaman</h2>
        <button
          onClick={onTambah}
          className="text-sm font-bold text-teal-600 bg-teal-50 px-3 py-1.5 rounded-lg"
        >
          + Pinjaman Baru
        </button>
      </div>

      <div className="flex bg-gray-100 rounded-xl p-1">
        {pilihan.map((o) => (
          <button
            key={o.key}
            onClick={() => onViewChange(o.key)}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
              view === o.key
                ? "bg-white text-teal-700 shadow-sm"
                : "text-gray-500"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {view === "portofolio" && (
        <PortofolioUtang pinjamanList={pinjamanList} pemasukan={pemasukan} />
      )}

      {view === "daftar" && pinjamanList.length === 0 && (
        <div className="bg-white p-6 rounded-2xl border border-dashed border-gray-300 text-center text-gray-400 text-sm">
          Tidak ada riwayat pinjaman aktif.
        </div>
      )}

      {view === "daftar" && pinjamanList.length > 0 && (
        <div className="space-y-4">
          {pinjamanList.map((p) => (
            <ItemPinjaman
              key={p.id}
              pinjaman={p}
              sekarang={sekarang}
              onBayar={onBayar}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface PeringatanTenggat {
  pinjaman: Pinjaman;
  tenggat: InfoTenggat;
  nominal: number;
}

function PanelNotifikasi({
  peringatan,
  onLihat,
}: Readonly<{ peringatan: PeringatanTenggat[]; onLihat: () => void }>) {
  if (peringatan.length === 0) return null;

  return (
    <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="font-bold text-gray-800 text-sm">
          🔔 Pengingat tenggat utang
        </h3>
        <button
          onClick={onLihat}
          className="text-[11px] font-bold text-teal-600"
        >
          Lihat pinjaman
        </button>
      </div>
      {peringatan.map(({ pinjaman, tenggat, nominal }) => {
        const warna = WARNA_TENGGAT[tenggat.tingkat];
        return (
          <div
            key={pinjaman.id}
            className={`border p-2.5 rounded-xl ${warna.kotak}`}
          >
            <p className={`text-xs font-bold ${warna.teks}`}>
              {warna.ikon} {pinjaman.nama} • {formatRupiah(nominal)}
            </p>
            <p className={`text-[11px] ${warna.teks}`}>
              {teksTenggat(tenggat)}
            </p>
          </div>
        );
      })}
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
  badge?: Partial<Record<TabType, number>>;
}

function NavBawah({ activeTab, onChange, badge }: Readonly<NavBawahProps>) {
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
          <span className="relative text-xl">
            {item.icon}
            {(badge?.[item.key] ?? 0) > 0 && (
              <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-rose-600 text-white text-[9px] font-bold flex items-center justify-center">
                {badge?.[item.key]}
              </span>
            )}
          </span>
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
        className="bg-white w-full rounded-t-3xl p-6 space-y-3 max-h-full overflow-y-auto"
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
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="pinj-bunga"
              className="block text-[11px] text-gray-500 mb-1"
            >
              Bunga per tahun (%)
            </label>
            <input
              id="pinj-bunga"
              name="bunga"
              type="number"
              min={0}
              step="0.1"
              defaultValue={0}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label
              htmlFor="pinj-tanggal"
              className="block text-[11px] text-gray-500 mb-1"
            >
              Jatuh tempo (tgl 1–31)
            </label>
            <input
              id="pinj-tanggal"
              name="tanggal"
              type="number"
              min={1}
              max={31}
              required
              placeholder="mis. 15"
              className={INPUT_CLASS}
            />
          </div>
        </div>
        <p className="text-[10px] text-gray-400">
          Bunga dihitung menurun (dari sisa utang) setiap bulan. Isi 0 jika
          tanpa bunga.
        </p>
        <TombolModal onTutup={onTutup} />
      </form>
    </div>
  );
}

// ==========================================
// MAIN APP COMPONENT
// ==========================================
function DashboardIsi({
  akun,
  awal,
  onLogout,
}: Readonly<{
  akun: Akun;
  awal: DataAkun | null;
  onLogout: () => void;
}>) {
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

  // 5. WAKTU & TAMPILAN PINJAMAN
  const [sekarang] = useState(() => new Date());
  const [pinjamanView, setPinjamanView] = useState<PinjamanView>("daftar");

  // 6. SIMULASI PENURUNAN PENDAPATAN
  const [simPersen, setSimPersen] = useState(20);
  const [simAcuanInput, setSimAcuanInput] = useState("");

  // 7. STATUS PENYIMPANAN KE SERVER
  const [statusSimpan, setStatusSimpan] = useState<StatusSimpan>("tersimpan");
  const lewatiPertama = useRef(true);

  // Simpan otomatis ke server (ditunda sebentar agar tidak terlalu sering)
  useEffect(() => {
    if (lewatiPertama.current) {
      lewatiPertama.current = false;
      return;
    }

    const data: DataAkun = {
      saldo,
      pemasukan,
      pengeluaran,
      transaksiList,
      pinjamanList,
    };
    let sudahKirim = false;

    const kirim = () => {
      if (sudahKirim) return;
      sudahKirim = true;
      setStatusSimpan("menyimpan");
      simpanDataServer(akun.id, data)
        .then(() => setStatusSimpan("tersimpan"))
        .catch(() => setStatusSimpan("gagal"));
    };

    const timer = setTimeout(kirim, 800);
    const saatTabDisembunyikan = () => {
      if (document.visibilityState === "hidden") {
        clearTimeout(timer);
        kirim();
      }
    };
    document.addEventListener("visibilitychange", saatTabDisembunyikan);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", saatTabDisembunyikan);
    };
  }, [akun.id, saldo, pemasukan, pengeluaran, transaksiList, pinjamanList]);

  const handleLogout = async () => {
    try {
      await simpanDataServer(akun.id, {
        saldo,
        pemasukan,
        pengeluaran,
        transaksiList,
        pinjamanList,
      });
    } catch {
      const lanjut = confirm(
        "Perubahan terakhir belum tersimpan ke server. Tetap keluar?",
      );
      if (!lanjut) return;
    }
    onLogout();
  };

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
    const bunga = Number(formData.get("bunga") || 0);
    const tanggal = Math.round(Number(formData.get("tanggal")));

    if (!nominal || nominal <= 0 || !cicilan || cicilan <= 0) return;
    if (bunga < 0 || tanggal < 1 || tanggal > 31) return;

    // Jika tanggal jatuh tempo bulan ini sudah lewat, tagihan pertama bulan depan
    const bulanIni = kunciBulan(sekarang);
    const bulanTagihan =
      tanggal >= sekarang.getDate() ? bulanIni : tambahBulan(bulanIni, 1);

    const newPinjaman: Pinjaman = {
      id: generateId(),
      nama: formData.get("nama") as string,
      totalUtang: nominal,
      sisaUtang: nominal,
      cicilanPerBulan: cicilan,
      bungaPersen: bunga,
      tanggalJatuhTempo: tanggal,
      bulanTagihan,
      kaliDibayar: 0,
      bungaTerbayar: 0,
      status: "aktif",
    };
    setPinjamanList((prev) => [newPinjaman, ...prev]);
    setShowAddPinjamanModal(false);
  };

  const handleBayarCicilan = (pinjamanId: number) => {
    const target = pinjamanList.find((p) => p.id === pinjamanId);
    if (target?.status !== "aktif") return;

    // Tagihan bulan ini = cicilan (cicilan terakhir bisa lebih kecil)
    const bayar = hitungTagihan(target);

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
  const peringatan: PeringatanTenggat[] = pinjamanList
    .filter((p) => p.status === "aktif")
    .map((p) => ({
      pinjaman: p,
      tenggat: hitungTenggat(p, sekarang),
      nominal: hitungTagihan(p),
    }))
    .filter((x) => x.tenggat.tingkat !== "aman")
    .sort((a, b) => a.tenggat.selisihHari - b.tenggat.selisihHari);

  const tampilkanSaldo = activeTab === "ringkasan" || activeTab === "transaksi";

  return (
    <div className="flex flex-col h-screen w-full max-w-md mx-auto bg-gray-50 text-gray-800 shadow-2xl relative overflow-hidden font-sans">
      <HeaderUtama
        nama={akun.nama}
        status={statusSimpan}
        onLogout={handleLogout}
        onTambah={() => setShowAddTrxModal(true)}
      />

      <main className="flex-1 overflow-y-auto p-5 pb-28 space-y-6">
        {tampilkanSaldo && (
          <div className="space-y-6">
            <PanelNotifikasi
              peringatan={peringatan}
              onLihat={() => {
                setPinjamanView("daftar");
                setActiveTab("pinjaman");
              }}
            />
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
            pemasukan={pemasukan}
            sekarang={sekarang}
            view={pinjamanView}
            onViewChange={setPinjamanView}
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

      <NavBawah
        activeTab={activeTab}
        onChange={setActiveTab}
        badge={{ pinjaman: peringatan.length }}
      />

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
// DASHBOARD: muat data dari server dulu
// ==========================================
function Dashboard({ akun }: Readonly<{ akun: Akun }>) {
  // undefined = sedang memuat, null = akun baru (belum ada data)
  const [awal, setAwal] = useState<DataAkun | null | undefined>(undefined);
  const [errorMuat, setErrorMuat] = useState("");
  const [percobaan, setPercobaan] = useState(0);

  useEffect(() => {
    let batal = false;
    muatDataServer(akun.id)
      .then((data) => {
        if (!batal) setAwal(data);
      })
      .catch((e: Error) => {
        if (!batal) setErrorMuat(e.message);
      });
    return () => {
      batal = true;
    };
  }, [akun.id, percobaan]);

  if (errorMuat) {
    return (
      <div className="flex min-h-screen max-w-md mx-auto bg-teal-900 justify-center items-center p-6 font-sans">
        <div className="bg-white p-8 rounded-3xl shadow-2xl w-full text-gray-800 space-y-4 text-center">
          <h1 className="text-xl font-bold">Data belum bisa dimuat</h1>
          <p className="text-xs text-gray-500 break-words">{errorMuat}</p>
          <p className="text-[11px] text-gray-400">
            Pastikan tabel data_akun sudah dibuat di Supabase, dan koneksi
            internet Anda aktif.
          </p>
          <button
            onClick={() => {
              setErrorMuat("");
              setPercobaan((n) => n + 1);
            }}
            className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-3 rounded-xl"
          >
            Coba lagi
          </button>
          <button
            onClick={keluarAkun}
            className="w-full text-sm font-bold text-teal-700"
          >
            Keluar
          </button>
        </div>
      </div>
    );
  }

  if (awal === undefined) return <LayarMemuat />;

  return <DashboardIsi akun={akun} awal={awal} onLogout={keluarAkun} />;
}

// ==========================================
// KOMPONEN UTAMA: pilih layar login atau dashboard
// ==========================================
export default function LunasinApp() {
  const sesi = useSesi();

  if (sesi === undefined) return <LayarMemuat />;
  if (!sesi) return <LayarAuth />;

  return <Dashboard key={sesi.id} akun={sesi} />;
}
