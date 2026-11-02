import type { GameState } from '../engine/types';
import { MIN_TEMP } from '../engine/types';
import { maxOceans, maxOxy, maxTemp, params, MAX_VENUS, type TrackBonus } from '../engine/board';
import { fmtTemp } from './format';
import { Num } from './Fx';

const BONUS_TEXT: Record<TrackBonus, string> = {
  heatProd: '+1 heat production', plantProd: '+1 plant production', ocean: 'place an ocean', temp: 'raise temperature', card: 'draw a card',
};

/** The three global parameters, drawn as instrument tubes beside the map (lengths follow the map). */
export function Gauges({ s }: { s: GameState }) {
  const mt = maxTemp(s), mo = maxOxy(s), mOc = maxOceans(s);
  const tempFrac = (t: number) => (t - MIN_TEMP) / (mt - MIN_TEMP);
  const tf = tempFrac(s.temperature);
  const of = s.oxygen / mo;
  const tSteps = (mt - MIN_TEMP) / 2;
  const done = (f: number) => (f >= 1 ? 'full' : '');
  const pr = params(s);
  return (
    <div className="gauges" aria-label="Global parameters">
      <div className={`gauge ${done(tf)}`}>
        <div className="gauge-read">{s.temperature > 0 ? '+' : ''}<Num value={s.temperature} />°C</div>
        <div className="tube temp" role="meter" aria-valuemin={MIN_TEMP} aria-valuemax={mt} aria-valuenow={s.temperature} aria-label="Temperature" aria-valuetext={fmtTemp(s.temperature)} style={{ ['--f' as string]: tf }}>
          <div className="tube-fill" />
          {Array.from({ length: tSteps }, (_, i) => <span key={i} className="tube-tick" style={{ ['--p' as string]: (i + 1) / tSteps }} />)}
          {pr.temp.map((b) => (
            <span key={b.at} className={`tube-bonus ${s.temperature >= b.at ? 'got' : ''}`} style={{ ['--p' as string]: tempFrac(b.at) }} title={`${fmtTemp(b.at)}: ${BONUS_TEXT[b.bonus]}`} />
          ))}
        </div>
        <div className="gauge-name">Temp</div>
      </div>
      <div className={`gauge ${done(of)}`}>
        <div className="gauge-read"><Num value={s.oxygen} />%</div>
        <div className="tube oxy" role="meter" aria-valuemin={0} aria-valuemax={mo} aria-valuenow={s.oxygen} aria-label="Oxygen" style={{ ['--f' as string]: of }}>
          <div className="tube-fill" />
          {Array.from({ length: mo - 1 }, (_, i) => <span key={i} className="tube-tick" style={{ ['--p' as string]: (i + 1) / mo }} />)}
          {pr.oxy.map((b) => (
            <span key={b.at} className={`tube-bonus ${s.oxygen >= b.at ? 'got' : ''}`} style={{ ['--p' as string]: b.at / mo }} title={`${b.at}%: ${BONUS_TEXT[b.bonus]}`} />
          ))}
        </div>
        <div className="gauge-name">O₂</div>
      </div>
      <div className={`gauge ${s.oceans >= mOc ? 'full' : ''}`}>
        <div className="gauge-read"><Num value={s.oceans} />/{mOc}</div>
        <div className="gauge-oceans" role="meter" aria-valuemin={0} aria-valuemax={mOc} aria-valuenow={s.oceans} aria-label="Oceans">
          {Array.from({ length: mOc }, (_, i) => mOc - 1 - i).map((i) => <span key={i} className={`ocean-dot ${i < s.oceans ? 'on' : ''}`} />)}
        </div>
        <div className="gauge-name">Oceans</div>
      </div>
      {s.venus !== undefined && (
        <div className={`gauge ${s.venus >= MAX_VENUS ? 'full' : ''}`}>
          <div className="gauge-read"><Num value={s.venus} />%</div>
          <div className="tube venus" role="meter" aria-valuemin={0} aria-valuemax={MAX_VENUS} aria-valuenow={s.venus} aria-label="Venus" style={{ ['--f' as string]: s.venus / MAX_VENUS }}>
            <div className="tube-fill" />
            {Array.from({ length: MAX_VENUS / 2 - 1 }, (_, i) => <span key={i} className="tube-tick" style={{ ['--p' as string]: (i + 1) / (MAX_VENUS / 2) }} />)}
            {[{ at: 8, text: 'draw a card' }, { at: 16, text: '+1 TR' }].map((b) => (
              <span key={b.at} className={`tube-bonus ${s.venus! >= b.at ? 'got' : ''}`} style={{ ['--p' as string]: b.at / MAX_VENUS }} title={`${b.at}%: ${b.text}`} />
            ))}
          </div>
          <div className="gauge-name" title="Venus isn’t needed to end the game">Venus</div>
        </div>
      )}
    </div>
  );
}
