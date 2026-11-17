import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { ArrowLeft, Calculator, Check, ChevronLeft, Clock3, Coins, Computer, Cpu, Info, LaptopMinimal, Monitor, RotateCcw, SquareArrowUpRight, TimerReset } from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

type Calculation = {
  start: string;
  end: string;
  minutes: number;
  remaining: number;
  firstRate: number;
  topUp: number;
  zoneLabel: string;
  promoRate: number;
  regularRate: number;
  segments: PricingSegment[];
};

type PricingSegment = {
  period: 'promo' | 'regular';
  start: string;
  end: string;
  minutes: number;
  rate: number;
  cost: number;
};

type PricingZone = {
  id: string;
  label: string;
  promoRate: number;
  regularRate: number;
};

const pricingZones: PricingZone[] = [
  { id: 'machines 25 bath', label: 'เครื่อง 25/ชม.', promoRate: 20, regularRate: 25 },
  { id: 'machines 30 bath', label: 'เครื่อง 30/ชม.', promoRate: 25, regularRate: 30 },
  { id: 'machines 18 bath', label: 'เครื่อง 18/ชม.', promoRate: 15, regularRate: 18 },
  { id: 'machines 35 bath', label: 'เครื่อง 35/ชม.', promoRate: 25, regularRate: 35 },
];

function currentTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function normalizeTimeInput(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function isValidTimeValue(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function isPromoTime(minuteOfDay: number) {
  const normalized = ((minuteOfDay % 1440) + 1440) % 1440;
  return normalized >= 60 && normalized < 960;
}

function rateAt(minuteOfDay: number, zone: PricingZone) {
  return isPromoTime(minuteOfDay) ? zone.promoRate : zone.regularRate;
}

function formatClock(minuteOfDay: number) {
  const normalized = ((minuteOfDay % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function calculateTime(start: string, topUp: number, zone: PricingZone): Calculation {
  const [hours, minutes] = start.split(':').map(Number);
  const startMinute = hours * 60 + minutes;
  let balance = topUp;
  let played = 0;
  let currentMinute = startMinute;
  const epsilon = 0.0000001;
  const segments: PricingSegment[] = [];
  let segmentStart = startMinute;
  let segmentMinutes = 0;
  let segmentCost = 0;
  let segmentPeriod: PricingSegment['period'] = isPromoTime(currentMinute) ? 'promo' : 'regular';

  while (balance + epsilon >= rateAt(currentMinute, zone) / 60) {
    const currentPeriod: PricingSegment['period'] = isPromoTime(currentMinute) ? 'promo' : 'regular';
    const currentRate = rateAt(currentMinute, zone);

    if (currentPeriod !== segmentPeriod) {
      segments.push({
        period: segmentPeriod,
        start: formatClock(segmentStart),
        end: formatClock(currentMinute),
        minutes: segmentMinutes,
        rate: segmentPeriod === 'promo' ? zone.promoRate : zone.regularRate,
        cost: Math.round(segmentCost * 100) / 100,
      });
      segmentStart = currentMinute;
      segmentMinutes = 0;
      segmentCost = 0;
      segmentPeriod = currentPeriod;
    }

    balance -= currentRate / 60;
    played += 1;
    currentMinute += 1;
    segmentMinutes += 1;
    segmentCost += currentRate / 60;
  }

  if (segmentMinutes > 0) {
    segments.push({
      period: segmentPeriod,
      start: formatClock(segmentStart),
      end: formatClock(currentMinute),
      minutes: segmentMinutes,
      rate: segmentPeriod === 'promo' ? zone.promoRate : zone.regularRate,
      cost: Math.round(segmentCost * 100) / 100,
    });
  }

  const endMinute = (startMinute + played) % 1440;
  return {
    start,
    end: `${String(Math.floor(endMinute / 60)).padStart(2, '0')}:${String(endMinute % 60).padStart(2, '0')}`,
    minutes: played,
    remaining: Math.max(0, balance),
    firstRate: rateAt(startMinute, zone),
    topUp,
    zoneLabel: zone.label,
    promoRate: zone.promoRate,
    regularRate: zone.regularRate,
    segments,
  };
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (!hours) return `${mins} นาที`;
  if (!mins) return `${hours} ชั่วโมง`;
  return `${hours} ชั่วโมง ${mins} นาที`;
}

function formatBaht(value: number) {
  return value < 0.01 ? '0.00' : value.toFixed(2);
}

function Home() {
  const [startTime, setStartTime] = useState(currentTime);
  const [topUp, setTopUp] = useState('');
  const [zoneId, setZoneId] = useState(pricingZones[0].id);
  const [calculation, setCalculation] = useState<Calculation | null>(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const amount = Number(topUp);
  const selectedZone = pricingZones.find((zone) => zone.id === zoneId) ?? pricingZones[0];
  const amountError = hasSubmitted && (!topUp || !Number.isFinite(amount) || amount <= 0)
    ? 'กรุณาใส่ยอดเงินที่มากกว่า 0 บาท'
    : '';
  const validStartTime = isValidTimeValue(startTime);
  const timeError = hasSubmitted && !validStartTime ? 'กรุณาใส่เวลาในรูปแบบ HH:MM เช่น 18:29' : '';
  const canCalculate = Boolean(validStartTime && topUp && Number.isFinite(amount) && amount > 0);
  const rateLabel = useMemo(
    () => (validStartTime
      ? rateAt(Number(startTime.split(':')[0]) * 60 + Number(startTime.split(':')[1]), selectedZone)
      : selectedZone.regularRate),
    [selectedZone, startTime, validStartTime],
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHasSubmitted(true);
    if (!canCalculate) return;
    setCalculation(calculateTime(startTime, amount, selectedZone));
  }

  function handleZoneChange(nextZoneId: string) {
    setZoneId(nextZoneId);
    setCalculation(null);
    setHasSubmitted(false);
  }

  function reset() {
    setStartTime(currentTime());
    setTopUp('');
    setZoneId(pricingZones[0].id);
    setCalculation(null);
    setHasSubmitted(false);
  }

  return (
    <main className="cafe-shell min-h-[100dvh] px-4 py-5 text-[hsl(var(--foreground))] sm:px-8 sm:py-8">
      <div className="page-enter mx-auto max-w-[1180px]">
        <header className="mb-7 flex items-center justify-between gap-4 sm:mb-10">
          <div className="flex items-center gap-3">
            <a href="https://jameshop.cloud/" 
                target="_self" 
                rel="noopener noreferrer"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[0_8px_18px_hsl(190_57%_27%_/_0.18)] hover:opacity-90 active:scale-95 transition-all">
              <Monitor size={22} strokeWidth={1.8} />
            </a>
            <div>
              <p className="mono text-[10px] font-medium uppercase tracking-[.22em] text-[hsl(var(--muted-foreground))]">counter tool / by jameshop</p>
              <a className="text-base font-bold tracking-[-.02em] sm:text-lg hover:underline active:underline" href="https://jameshop.cloud/" target="_self" rel="noopener noreferrer">
                คลิกเพื่อเข้าสู่หน้าเว็บ Jame Shop
              </a>
            </div>
          </div>
          <div data-testid="status-ready" className="flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card)/.7)] px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
            <span className="pulse-dot h-2 w-2 rounded-full bg-[hsl(var(--accent))]" />
            <span>พร้อมคำนวณ</span>
          </div>
        </header>

        <div className="mb-8 max-w-3xl sm:mb-10">
          <p className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-[.12em] text-[hsl(var(--accent))]">
            <span className="h-px w-7 bg-[hsl(var(--accent))]" />
            คิดเวลาแบบนาทีต่อนาที
          </p>
          <h2 className="max-w-2xl text-[clamp(2.25rem,5vw,4.6rem)] font-bold leading-[1.08] tracking-[-.055em]">
            รู้เวลาล็อกเอาต์<br /><span className="text-[hsl(var(--primary))]">ก่อนเติมเงินทุกครั้ง</span>
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-7 text-[hsl(var(--muted-foreground))] sm:text-base">
            ใส่เวลาเริ่มเล่นและยอดเงิน ระบบจะคิดค่าใช้บริการแบบนาทีต่อนาที ณ เวลาที่เล่นอยู่ขณะนั้น เวลาจะถูกบวกลบตามช่วงเวลาที่กำลังเล่นอยู่ และแสดงผลลัพธ์เวลาล็อกเอาต์
          </p>
        </div>

        <div className="grid items-stretch gap-5 lg:grid-cols-[minmax(310px,0.82fr)_minmax(470px,1.18fr)]">
          <section className="rounded-[1.6rem] border border-[hsl(var(--card-border))] bg-[hsl(var(--card)/.82)] p-5 shadow-[var(--shadow-md)] backdrop-blur-sm sm:p-7">
            <div className="mb-7 flex items-start justify-between gap-4">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" />
                  <p className="mono text-[10px] tracking-[.18em] text-[hsl(var(--muted-foreground))]">INPUT DETAILS</p>
                </div>
                <h3 className="text-xl font-bold">เริ่มคำนวณ</h3>
                <p className="mt-1.5 text-xs leading-5 text-[hsl(var(--muted-foreground))]">เลือกโซน กรอกเวลา และยอดเติมเงิน</p>
              </div>
              <div className="rounded-2xl bg-[hsl(var(--secondary))] p-3 text-[hsl(var(--primary))] shadow-[0_6px_14px_hsl(190_57%_27%_/.08)]">
                <Calculator size={19} strokeWidth={1.8} />
              </div>
            </div>

            <form onSubmit={handleSubmit} noValidate>
              <div className="space-y-6">
                <fieldset className="block">
                  <legend className="mb-3 flex w-full items-center justify-between text-sm font-semibold">
                    <span>โซนราคา</span>
                    <span className="mono text-[10px] font-normal tracking-wide text-[hsl(var(--muted-foreground))]">เลือกโซนเครื่อง</span>
                  </legend>
                  <div role="radiogroup" aria-label="โซนราคา" className="grid grid-cols-2 gap-2.5">
                    {pricingZones.map((zone) => {
                      const isSelected = zone.id === zoneId;
                      return (
                        <button
                          key={zone.id}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          data-testid={`button-zone-${zone.id}`}
                          data-selected={isSelected}
                          onClick={() => handleZoneChange(zone.id)}
                          className="zone-option rounded-2xl border px-3.5 py-3 text-left"
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-sm font-bold">{zone.label}</span>
                            <span className="zone-check flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]">
                              {isSelected ? '✓' : ''}
                            </span>
                          </span>
                          <span className="mt-2 flex items-center justify-between gap-2 text-[10px] text-[hsl(var(--muted-foreground))]">
                            <span>โปร <b className="font-semibold text-[hsl(var(--foreground))]">{zone.promoRate}</b></span>
                            <span className="h-3.5 w-px bg-[hsl(var(--border))]" />
                            <span>ปกติ <b className="font-semibold text-[hsl(var(--foreground))]">{zone.regularRate}</b></span>
                            <span className="mono">บาท/ชม.</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2.5 flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" />
                    {selectedZone.label} · โปร 01:00–16:00 {selectedZone.promoRate} บาท/ชม. · ปกติ {selectedZone.regularRate} บาท/ชม.
                  </p>
                </fieldset>

                <div className="grid gap-5 md:grid-cols-2">
                  <label className="block">
                  <span className="mb-2.5 flex items-center justify-between text-sm font-semibold">
                    <span>เวลาเริ่มเล่น</span>
                    <span className="mono text-[10px] font-normal tracking-wide text-[hsl(var(--muted-foreground))]">24-HOUR</span>
                  </span>
                    <div className={`field-ring flex h-[62px] items-center rounded-2xl border bg-[hsl(var(--background)/.55)] px-4 transition-colors ${timeError ? 'border-[hsl(var(--destructive))]' : 'border-[hsl(var(--input))]'}`}>
                    <input
                      aria-label="เวลาเริ่มเล่น"
                      data-testid="input-start-time"
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={5}
                      value={startTime}
                        placeholder="18:29"
                      aria-invalid={Boolean(timeError)}
                      aria-describedby="start-time-help"
                        onChange={(event) => { setStartTime(normalizeTimeInput(event.target.value)); setCalculation(null); setHasSubmitted(false); }}
                        className="mono w-full bg-transparent text-2xl font-medium tracking-[-.04em] outline-none placeholder:text-[hsl(var(--muted-foreground)/.4)]"
                    />
                    <Clock3 size={19} className="text-[hsl(var(--muted-foreground))]" strokeWidth={1.7} />
                  </div>
                    {timeError ? <span id="start-time-help" className="mt-2 block text-xs text-[hsl(var(--destructive))]">{timeError}</span> : (
                      <span id="start-time-help" className="mt-2 block text-xs text-[hsl(var(--muted-foreground))]">
                        {validStartTime ? <>อัตราปัจจุบัน: <b className="font-semibold text-[hsl(var(--foreground))]">{rateLabel} บาท / ชั่วโมง</b></> : 'พิมพ์ตัวเลข 4 หลัก เช่น 1829 ระบบจะเติม : ให้อัตโนมัติ'}
                      </span>
                    )}
                  </label>

                  <label className="block">
                  <span className="mb-2.5 flex items-center justify-between text-sm font-semibold">
                    <span>ยอดเติมเงิน</span>
                    <span className="text-xs font-normal text-[hsl(var(--muted-foreground))]">บาท</span>
                  </span>
                  <div className={`field-ring flex h-[62px] items-center rounded-2xl border bg-[hsl(var(--background)/.55)] px-4 transition-colors ${amountError ? 'border-[hsl(var(--destructive))]' : 'border-[hsl(var(--input))]'}`}>
                    <input
                      aria-label="ยอดเติมเงิน"
                      data-testid="input-top-up"
                      type="number"
                      min="1"
                      step="1"
                      inputMode="decimal"
                      placeholder="เช่น 100"
                      value={topUp}
                      aria-invalid={Boolean(amountError)}
                      aria-describedby="top-up-help"
                       onChange={(event) => { setTopUp(event.target.value); setCalculation(null); setHasSubmitted(false); }}
                        className="no-spinner mono w-full appearance-none bg-transparent text-2xl font-medium tracking-[-.04em] outline-none placeholder:text-[hsl(var(--muted-foreground)/.45)]"
                    />
                    <Coins size={19} className="text-[hsl(var(--accent))]" strokeWidth={1.7} />
                  </div>
                  {amountError ? <span id="top-up-help" className="mt-2 block text-xs text-[hsl(var(--destructive))]">{amountError}</span> : <span id="top-up-help" className="mt-2 block text-xs text-[hsl(var(--muted-foreground))]">คิดตามยอดคงเหลือจริง</span>}
                  </label>
                </div>

                <div>
                  <div className="mb-2.5 flex items-center justify-between">
                    <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">ยอดที่ใช้บ่อย</p>
                    <p className="mono text-[10px] text-[hsl(var(--muted-foreground))]">QUICK AMOUNT</p>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[50, 100, 200, 500].map((value) => (
                      <button
                        key={value}
                        type="button"
                        data-testid={`button-preset-${value}`}
                        onClick={() => { setTopUp(String(value)); setHasSubmitted(false); }}
                        className={`preset-button rounded-xl border py-2.5 text-sm font-semibold ${topUp === String(value) ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent)/.1)] text-[hsl(var(--foreground))]' : 'border-[hsl(var(--border))] bg-transparent text-[hsl(var(--muted-foreground))]'}`}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button
                type="submit"
                data-testid="button-calculate"
                disabled={!canCalculate}
                className="primary-button mt-7 flex h-[58px] w-full items-center justify-center gap-2 rounded-2xl bg-[hsl(var(--primary))] text-sm font-bold text-[hsl(var(--primary-foreground))] disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Calculator size={18} strokeWidth={2} />
                คำนวณเวลาใช้งาน
              </button>
            </form>

            <div className="mt-6 flex items-start gap-2.5 border-t border-[hsl(var(--border))] pt-5 text-xs leading-5 text-[hsl(var(--muted-foreground))]">
              <Info size={15} className="mt-0.5 shrink-0 text-[hsl(var(--accent))]" />
              <p>ระบบจะหยุดเวลาเมื่อยอดเงินไม่พอสำหรับการใช้งานเต็ม 1 นาที</p>
            </div>
          </section>

          <section aria-live="polite" data-testid="result-panel" className="relative min-h-[430px] overflow-hidden rounded-[1.6rem] bg-[hsl(var(--primary))] p-5 text-[hsl(var(--primary-foreground))] shadow-[var(--shadow-lg)] sm:p-8">
            <div className="absolute -right-28 -top-28 h-72 w-72 rounded-full border border-[hsl(39_36%_96%/.1)]" />
            <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full border border-[hsl(39_36%_96%/.1)]" />
            <div className="relative z-10 flex h-full flex-col">
              {!calculation ? (
                <div className="empty-orbit flex flex-1 flex-col items-center justify-center rounded-[1.1rem] border border-[hsl(39_36%_96%/.12)] px-5 py-12 text-center">
                  <div className="relative mb-7 flex h-24 w-24 items-center justify-center rounded-full border border-[hsl(39_36%_96%/.22)]">
                    <div className="absolute inset-2 rounded-full border border-dashed border-[hsl(25_72%_57%/.65)]" />
                    <TimerReset size={29} className="text-[hsl(var(--accent))]" strokeWidth={1.5} />
                  </div>
                  <p className="mono mb-3 text-[10px] tracking-[.2em] text-[hsl(39_36%_96%/.58)]">RESULT AWAITS</p>
                  <h3 className="text-xl font-bold">ผลลัพธ์จะแสดงที่นี่</h3>
                  <p className="mt-2 max-w-xs text-sm leading-6 text-[hsl(39_36%_96%/.62)]">กรอกข้อมูล แล้วกดคำนวณเพื่อดูเวลาล็อกเอาต์</p>
                </div>
              ) : (
                <div className="result-enter flex h-full flex-col">
                  <div className="mb-8 flex items-start justify-between">
                    <div>
                      <p className="mono mb-2 text-[10px] tracking-[.18em] text-[hsl(39_36%_96%/.58)]">SESSION RESULT</p>
                      <h3 className="text-xl font-bold">สรุปเวลาใช้งาน</h3>
                    </div>
                    <div className="flex items-center gap-1.5 rounded-full border border-[hsl(39_36%_96%/.17)] px-3 py-1.5 text-xs text-[hsl(39_36%_96%/.78)]">
                      <Check size={13} className="text-[hsl(var(--accent))]" strokeWidth={2.5} />
                      คำนวณแล้ว
                    </div>
                  </div>

                  <div className="mb-7 rounded-2xl bg-[hsl(39_36%_96%/.09)] px-5 py-6">
                    <p className="mb-2 text-sm text-[hsl(39_36%_96%/.62)]">ควรล็อกเอาต์เวลา</p>
                    <div className="flex items-end gap-3">
                      <span data-testid="text-logout-time" className="mono text-[clamp(3.5rem,8vw,6.2rem)] font-medium leading-none tracking-[-.08em] text-[hsl(var(--primary-foreground))]">{calculation.end}</span>
                      <span className="mb-2 text-sm text-[hsl(39_36%_96%/.58)]">น.</span>
                    </div>
                     <p className="mt-3 text-xs text-[hsl(39_36%_96%/.53)]">{calculation.zoneLabel} · เริ่มเล่น {calculation.start} น. · ใช้ได้ {formatDuration(calculation.minutes)}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-[hsl(39_36%_96%/.14)] p-4">
                      <p className="mb-3 text-xs text-[hsl(39_36%_96%/.55)]">เวลาใช้งาน</p>
                      <p data-testid="text-duration" className="text-lg font-bold">{formatDuration(calculation.minutes)}</p>
                      <p className="mono mt-1 text-[10px] text-[hsl(39_36%_96%/.48)]">รวมทั้งหมด {calculation.minutes} นาที</p>
                    </div>
                    <div className="rounded-2xl border border-[hsl(39_36%_96%/.14)] p-4">
                      <p className="mb-3 text-xs text-[hsl(39_36%_96%/.55)]">เงินคงเหลือ</p>
                      <p data-testid="text-remaining-balance" className="mono text-lg font-bold">{formatBaht(calculation.remaining)} <span className="font-sans text-xs font-normal">บาท</span></p>
                      <p className="mt-1 text-[10px] text-[hsl(39_36%_96%/.48)]">หลังหมดเวลา</p>
                    </div>
                  </div>

                  <div className="mt-5 rounded-2xl border border-[hsl(39_36%_96%/.14)] bg-[hsl(39_36%_96%/.06)] p-4 sm:p-5">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 rounded-lg bg-[hsl(25_72%_57%/.16)] p-2 text-[hsl(var(--accent))]">
                        <Info size={16} strokeWidth={1.8} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">รายละเอียดการคำนวณราคา</p>
                        <p className="mt-1 text-xs leading-5 text-[hsl(39_36%_96%/.58)]">
                          {calculation.zoneLabel} · คิดค่าบริการทีละ 1 นาที ตามช่วงเวลาที่ใช้งาน
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 border-t border-[hsl(39_36%_96%/.1)] pt-4">
                      <p className="mb-2.5 text-xs font-semibold text-[hsl(39_36%_96%/.78)]">แบ่งเงินตามช่วงเวลาที่เล่น</p>
                      {calculation.segments.length > 0 ? (
                        <div className="space-y-2">
                          {calculation.segments.map((segment, index) => (
                            <div key={`${segment.period}-${segment.start}-${index}`} className="rounded-xl border border-[hsl(39_36%_96%/.1)] px-3 py-2.5">
                              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                                <span className="font-semibold text-[hsl(39_36%_96%/.9)]">
                                  {segment.period === 'promo' ? 'ช่วงโปร' : 'ช่วงปกติ'} · {segment.rate} บาท/ชม.
                                </span>
                                <span className="mono text-[10px] text-[hsl(39_36%_96%/.55)]">
                                  {segment.start}–{segment.end} น. · {formatDuration(segment.minutes)}
                                </span>
                              </div>
                              <p className="mt-1 text-[11px] text-[hsl(39_36%_96%/.55)]">
                                ใช้เงิน <span className="mono font-semibold text-[hsl(39_36%_96%/.88)]">{formatBaht(segment.cost)}</span> บาท
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs leading-5 text-[hsl(39_36%_96%/.55)]">ยอดเงินไม่พอสำหรับการใช้งานเต็ม 1 นาที</p>
                      )}
                      <p className="mt-2.5 text-[11px] text-[hsl(39_36%_96%/.48)]">
                        รวมใช้เงิน <span className="mono">{formatBaht(calculation.topUp - calculation.remaining)}</span> บาท · เหลือ <span className="mono">{formatBaht(calculation.remaining)}</span> บาท
                      </p>
                    </div>
                    <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
                      <div className="rounded-xl border border-[hsl(39_36%_96%/.1)] px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2 text-[hsl(39_36%_96%/.55)]">
                          <span>ช่วงโปร 01:00–16:00</span>
                          <span className="font-semibold text-[hsl(39_36%_96%/.9)]">{calculation.promoRate} บาท/ชม.</span>
                        </div>
                        <p className="mono mt-1 text-[10px] text-[hsl(39_36%_96%/.42)]">
                          {(calculation.promoRate / 60).toFixed(2)} บาท/นาที
                        </p>
                      </div>
                      <div className="rounded-xl border border-[hsl(39_36%_96%/.1)] px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2 text-[hsl(39_36%_96%/.55)]">
                          <span>ช่วงปกติ 16:00–01:00</span>
                          <span className="font-semibold text-[hsl(39_36%_96%/.9)]">{calculation.regularRate} บาท/ชม.</span>
                        </div>
                        <p className="mono mt-1 text-[10px] text-[hsl(39_36%_96%/.42)]">
                          {(calculation.regularRate / 60).toFixed(2)} บาท/นาที
                        </p>
                      </div>
                    </div>
                    <p className="mt-3 text-[11px] leading-5 text-[hsl(39_36%_96%/.48)]">
                      ระบบจะหยุดเวลาเมื่อยอดเงินไม่พอสำหรับการใช้งานเต็ม 1 นาที และเก็บเงินส่วนที่เหลือไว้แสดงด้านบน
                    </p>
                  </div>

                  <div className="mt-auto flex items-center justify-between border-t border-[hsl(39_36%_96%/.13)] pt-5">
                     <p className="text-xs text-[hsl(39_36%_96%/.58)]">เติมเงิน {calculation.topUp.toLocaleString('th-TH')} บาท · เรทเริ่มต้น {calculation.firstRate} บาท/ชม.</p>
                    <button type="button" data-testid="button-reset" onClick={reset} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-[hsl(39_36%_96%/.72)] transition-colors hover:bg-[hsl(39_36%_96%/.1)] hover:text-[hsl(var(--primary-foreground))]">
                      <RotateCcw size={13} />
                      เริ่มใหม่
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        <footer className="mt-7 flex flex-col justify-between gap-2 text-xs text-[hsl(var(--muted-foreground))] sm:flex-row sm:items-center">
          <p>โซน {selectedZone.label}: 01:00–16:00 <span className="mono">{selectedZone.promoRate}</span> บาท/ชม. · 16:00–01:00 <span className="mono">{selectedZone.regularRate}</span> บาท/ชม.</p>
          <p className="mono tracking-wide">MINUTE-BY-MINUTE / TH</p>
        </footer>
      </div>
    </main>
  );
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  return <ErrorBoundary resetKey="/">{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
