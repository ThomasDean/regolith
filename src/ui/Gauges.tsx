import type { GameState } from '../engine/types';
import { MAX_OCEANS, MAX_OXY, MAX_TEMP, MIN_TEMP } from '../engine/types';
import { fmtTemp } from './format';
import { Num } from './Fx';

const tempFrac = (t: number) => (t - MIN_TEMP) / (MAX_TEMP - MIN_TEMP);

/** The three global parameters, drawn as instrument tubes beside the map. */
export function Gauges({ s }: { s: GameState }) {
  const tf = tempFrac(s.temperature);
  const of = s.oxygen / MAX_OXY;
  const done = (f: number) => (f >= 1 ? 'full' : '');
  return (
    <div className="gauges" aria-label="Global parameters">
      <div className={`gauge ${done(tf)}`}>
        <div className="gauge-read">{s.temperature > 0 ? '+' : ''}<Num value={s.temperature} />°C</div>
        <div className="tube temp" role="meter" aria-valuemin={MIN_TEMP} aria-valuemax={MAX_TEMP} aria-valuenow={s.temperature} aria-label="Temperature" aria-valuetext={fmtTemp(s.temperature)} style={{ ['--f' as string]: tf }}>
          <div className="tube-fill" />
          {Array.from({ length: 19 }, (_, i) => <span key={i} className="tube-tick" style={{ ['--p' as string]: (i + 1) / 19 }} />)}
          {[-24, -20, 0].map((t) => (
            <span key={t} className={`tube-bonus ${s.temperature >= t ? 'got' : ''}`} style={{ ['--p' as string]: tempFrac(t) }} title={t === 0 ? '0°C: place an ocean' : `${t}°C: +1 heat production`} />
          ))}
        </div>
        <div className="gauge-name">Temp</div>
      </div>
      <div className={`gauge ${done(of)}`}>
        <div className="gauge-read"><Num value={s.oxygen} />%</div>
        <div className="tube oxy" role="meter" aria-valuemin={0} aria-valuemax={MAX_OXY} aria-valuenow={s.oxygen} aria-label="Oxygen" style={{ ['--f' as string]: of }}>
          <div className="tube-fill" />
          {Array.from({ length: 13 }, (_, i) => <span key={i} className="tube-tick" style={{ ['--p' as string]: (i + 1) / 14 }} />)}
          <span className={`tube-bonus ${s.oxygen >= 8 ? 'got' : ''}`} style={{ ['--p' as string]: 8 / 14 }} title="8%: raise temperature" />
        </div>
        <div className="gauge-name">O₂</div>
      </div>
      <div className={`gauge ${s.oceans >= MAX_OCEANS ? 'full' : ''}`}>
        <div className="gauge-read"><Num value={s.oceans} />/9</div>
        <div className="gauge-oceans" role="meter" aria-valuemin={0} aria-valuemax={MAX_OCEANS} aria-valuenow={s.oceans} aria-label="Oceans">
          {Array.from({ length: 9 }, (_, i) => 8 - i).map((i) => <span key={i} className={`ocean-dot ${i < s.oceans ? 'on' : ''}`} />)}
        </div>
        <div className="gauge-name">Oceans</div>
      </div>
    </div>
  );
}
