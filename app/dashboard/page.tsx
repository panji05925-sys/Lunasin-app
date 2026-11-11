"use client";

import React, { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

// ==========================================
// TYPES
// ==========================================
type TipeTransaksi = "pemasukan" | "pengeluaran";
type DropdownDTI = 0 | 25 | 50;
type TabType = "ringkasan" | "transaksi" | "pinjaman" | "laporan";
type AuthMode = "masuk" | "daftar" | "cekEmail";

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

interface Akun {
  id: string;
  email: string;
  nama: string;
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
];

const AUTH_INPUT_CLASS =
  "w-full p-4 bg-gray-50 border border-gray-300 rounded-xl text-sm text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-teal-500 outline-none transition-all";

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

const userKeAkun = (user: User): Akun => ({
  id: user.id,
  email: user.email ?? "",
  nama:
    (user.user_metadata?.nama as string | undefined) || user.email || "User",
});

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

const getLabelTombolAuth = (authLoading: boolean, isDaftar: boolean) => {
  if (authLoading) return "Memproses...";
  if (isDaftar) return "Daftar";
  return "Masuk Sekarang";
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
// KOMPONEN: LAYAR CEK EMAIL
// ==========================================
interface LayarCekEmailProps {
  email: string;
  authInfo: string;
  authLoading: boolean;
  onKirimUlang: () => void;
  onKembali: () => void;
}

function LayarCekEmail({
  email,
  authInfo,
  authLoading,
  onKirimUlang,
  onKembali,
}: Readonly<LayarCekEmailProps>) {
  return (
    <div className="flex h-screen max-w-md mx-auto bg-teal-900 justify-center items-center p-6 font-sans">
      <div className="bg-white p-8 rounded-3xl shadow-2xl w-full text-gray-800 space-y-5 text-center">
        <div className="w-16 h-16 bg-teal-50 rounded-2xl mx-auto flex justify-center items-center text-3xl">
          ✉️
        </div>
        <h1 className="text-2xl font-bold">Cek Email Anda</h1>
        <p className="text-sm text-gray-600">
          Kami mengirim tautan verifikasi ke{" "}
          <span className="font-bold text-gray-800">{email}</span>. Klik tautan
          itu untuk mengaktifkan akun, lalu masuk.
        </p>
        {authInfo && (
          <p className="text-xs font-bold text-teal-700">{authInfo}</p>
        )}
        <button
          type="button"
          onClick={onKirimUlang}
          disabled={authLoading}
          className="w-full bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white font-bold py-3 rounded-xl transition-all active:scale-95"
        >
          {authLoading ? "Mengirim..." : "Kirim Ulang Email"}
        </button>
        <button
          type="button"
          onClick={onKembali}
          className="w-full text-sm font-bold text-teal-700"
        >
          Kembali ke halaman masuk
        </button>
      </div>
    </div>
  );
}

// ==========================================
// KOMPONEN: LAYAR MASUK / DAFTAR
// ==========================================
interface LayarAuthProps {
  isDaftar: boolean;
  nama: string;
  email: string;
  password: string;
  loginError: string;
  authLoading: boolean;
  onNamaChange: (v: string) => void;
  onEmailChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onSubmit: (e: React.SyntheticEvent<HTMLFormElement>) => void;
  onToggleMode: () => void;
}

function LayarAuth({
  isDaftar,
  nama,
  email,
  password,
  loginError,
  authLoading,
  onNamaChange,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  onToggleMode,
}: Readonly<LayarAuthProps>) {
  const labelTombol = getLabelTombolAuth(authLoading, isDaftar);

  return (
    <div className="flex h-screen max-w-md mx-auto bg-teal-900 justify-center items-center p-6 text-white font-sans">
      <form
        onSubmit={onSubmit}
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
              ? "Daftar dengan email, lalu verifikasi lewat tautan yang kami kirim"
              : "Silakan masuk untuk memonitor keuangan"}
          </p>
        </div>

        {loginError && (
          <p className="text-red-500 text-xs text-center font-bold">
            {loginError}
          </p>
        )}

        <div className="space-y-4">
          {isDaftar && (
            <input
              type="text"
              placeholder="Nama lengkap"
              required
              aria-label="Nama lengkap"
              value={nama}
              onChange={(e) => onNamaChange(e.target.value)}
              className={AUTH_INPUT_CLASS}
            />
          )}
          <input
            type="email"
            placeholder="Email"
            required
            aria-label="Email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            className={AUTH_INPUT_CLASS}
          />
          <input
            type="password"
            placeholder="Kata sandi (min. 6 karakter)"
            required
            minLength={6}
            aria-label="Kata sandi"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            className={AUTH_INPUT_CLASS}
          />
        </div>

        <button
          type="submit"
          disabled={authLoading}
          className="w-full bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white font-bold py-4 rounded-xl shadow-lg transition-all active:scale-95"
        >
          {labelTombol}
        </button>

        <p className="text-center text-sm text-gray-500">
          {isDaftar ? "Sudah punya akun?" : "Belum punya akun?"}{" "}
          <button
            type="button"
            onClick={onToggleMode}
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
          className={`flex flex-col items-center px-3 py-1 text-[10px] font-bold transition-colors ${
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
export default function LunasinApp() {
  // 1. AUTH STATE
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [cekSesi, setCekSesi] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>("masuk");
  const [nama, setNama] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [authInfo, setAuthInfo] = useState("");
  const [akunAktif, setAkunAktif] = useState<Akun | null>(null);

  // 2. DASHBOARD STATE
  const [activeTab, setActiveTab] = useState<TabType>("ringkasan");
  const [saldo, setSaldo] = useState(0);
  const [pemasukan, setPemasukan] = useState(0);
  const [pengeluaran, setPengeluaran] = useState(0);

  // 3. TRANSAKSI & PINJAMAN STATE
  const [transaksiList, setTransaksiList] = useState<Transaksi[]>([]);
  const [showAddTrxModal, setShowAddTrxModal] = useState(false);
  const [pinjamanList, setPinjamanList] = useState<Pinjaman[]>([]);
  const [showAddPinjamanModal, setShowAddPinjamanModal] = useState(false);

  // 4. LAPORAN/DTI STATE
  const [dtiDropdown, setDtiDropdown] = useState<DropdownDTI>(0);

  // --- AUTH (Supabase) ---
  const masukSebagai = useCallback((akun: Akun) => {
    const data = bacaDataAkun(akun.id);
    setSaldo(data?.saldo ?? 0);
    setPemasukan(data?.pemasukan ?? 0);
    setPengeluaran(data?.pengeluaran ?? 0);
    setTransaksiList(data?.transaksiList ?? []);
    setPinjamanList(data?.pinjamanList ?? []);
    setAkunAktif(akun);
    setActiveTab("ringkasan");
    setDtiDropdown(0);
    setIsAuthenticated(true);
  }, []);

  // Cek sesi saat halaman dibuka (termasuk setelah klik tautan verifikasi email)
  useEffect(() => {
    let batal = false;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (batal) return;
        if (data.session?.user) masukSebagai(userKeAkun(data.session.user));
        setCekSesi(false);
      })
      .catch(() => {
        if (!batal) setCekSesi(false);
      });
    return () => {
      batal = true;
    };
  }, [masukSebagai]);

  // Simpan data otomatis setiap ada perubahan
  useEffect(() => {
    if (!akunAktif) return;
    simpanDataAkun(akunAktif.id, {
      saldo,
      pemasukan,
      pengeluaran,
      transaksiList,
      pinjamanList,
    });
  }, [akunAktif, saldo, pemasukan, pengeluaran, transaksiList, pinjamanList]);

  const prosesDaftar = async () => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { nama: nama.trim() },
        emailRedirectTo: `${window.location.origin}/dashboard`,
      },
    });
    if (error) {
      setLoginError(error.message);
      return;
    }
    // Supabase mengembalikan identities kosong jika email sudah terdaftar
    if (data.user?.identities?.length === 0) {
      setLoginError("Email ini sudah terdaftar. Silakan masuk.");
      return;
    }
    setPassword("");
    // Jika konfirmasi email dimatikan, sesi langsung aktif
    if (data.session && data.user) {
      masukSebagai(userKeAkun(data.user));
      return;
    }
    setAuthMode("cekEmail");
  };

  const prosesMasuk = async () => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      if (error.message.toLowerCase().includes("not confirmed")) {
        setPassword("");
        setAuthInfo(
          "Email Anda belum diverifikasi. Klik tautan di email, atau kirim ulang.",
        );
        setAuthMode("cekEmail");
      } else {
        setLoginError("Email atau kata sandi salah!");
      }
      return;
    }
    setPassword("");
    masukSebagai(userKeAkun(data.user));
  };

  const handleSubmitAuth = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoginError("");
    setAuthInfo("");
    setAuthLoading(true);
    try {
      if (authMode === "daftar") await prosesDaftar();
      else await prosesMasuk();
    } catch {
      setLoginError(
        "Gagal terhubung ke server. Periksa koneksi internet Anda.",
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const handleKirimUlang = async () => {
    setAuthInfo("");
    setAuthLoading(true);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/dashboard` },
      });
      setAuthInfo(
        error ? error.message : "Email verifikasi sudah dikirim ulang.",
      );
    } catch {
      setAuthInfo("Gagal terhubung ke server. Coba lagi.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setAkunAktif(null);
    setPassword("");
    setLoginError("");
    setAuthInfo("");
    setAuthMode("masuk");
    setIsAuthenticated(false);
  };

  const handleToggleMode = () => {
    setLoginError("");
    setAuthMode(authMode === "daftar" ? "masuk" : "daftar");
  };

  const handleKembaliKeMasuk = () => {
    setAuthInfo("");
    setAuthMode("masuk");
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
  if (cekSesi) return <LayarMemuat />;

  if (!isAuthenticated) {
    if (authMode === "cekEmail") {
      return (
        <LayarCekEmail
          email={email}
          authInfo={authInfo}
          authLoading={authLoading}
          onKirimUlang={handleKirimUlang}
          onKembali={handleKembaliKeMasuk}
        />
      );
    }
    return (
      <LayarAuth
        isDaftar={authMode === "daftar"}
        nama={nama}
        email={email}
        password={password}
        loginError={loginError}
        authLoading={authLoading}
        onNamaChange={setNama}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onSubmit={handleSubmitAuth}
        onToggleMode={handleToggleMode}
      />
    );
  }

  const tampilkanSaldo = activeTab === "ringkasan" || activeTab === "transaksi";

  return (
    <div className="flex flex-col h-screen w-full max-w-md mx-auto bg-gray-50 text-gray-800 shadow-2xl relative overflow-hidden font-sans">
      <HeaderUtama
        nama={akunAktif?.nama ?? "User"}
        onLogout={handleLogout}
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
