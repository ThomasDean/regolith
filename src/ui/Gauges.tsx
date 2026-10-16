import type { GameState } from '../engine/types';
import { fmtTemp } from './format';

/** The three global parameters, drawn as instrument scales beside the map. */
export function Gauges({ s }: { s: GameState }) {
  const tempSteps = Array.from({ length: 20 }, (_, i) => -30 + i * 2).reverse();
  const oxySteps = Array.from({ length: 15 }, (_, i) => i).reverse();
  return (
    <div className="gauges" aria-label="Global parameters">
      <div className="gauge">
        <div className="gauge-read">{fmtTemp(s.temperature)}</div>
        <div className="gauge-scale" role="meter" aria-valuemin={-30} aria-valuemax={8} aria-valuenow={s.temperature} aria-label="Temperature">
          {tempSteps.map((t) => (
            <span key={t} className={`tick temp ${t <= s.temperature ? 'on' : ''} ${t === -24 || t === -20 || t === 0 ? 'bonus' : ''}`} title={t === 0 ? '0°C: place an ocean' : t === -24 || t === -20 ? `${t}°C: +1 heat production` : undefined} />
          ))}
        </div>
        <div className="gauge-name">Temp</div>
      </div>
      <div className="gauge">
        <div className="gauge-read">{s.oxygen}%</div>
        <div className="gauge-scale" role="meter" aria-valuemin={0} aria-valuemax={14} aria-valuenow={s.oxygen} aria-label="Oxygen">
          {oxySteps.map((o) => (
            <span key={o} className={`tick oxy ${o <= s.oxygen && o > 0 ? 'on' : ''} ${o === 8 ? 'bonus' : ''} ${o === 0 ? 'zero' : ''}`} title={o === 8 ? '8%: raise temperature' : undefined} />
          ))}
        </div>
        <div className="gauge-name">O₂</div>
      </div>
      <div className="gauge">
        <div className="gauge-read">{s.oceans}/9</div>
        <div className="gauge-oceans" role="meter" aria-valuemin={0} aria-valuemax={9} aria-valuenow={s.oceans} aria-label="Oceans">
          {Array.from({ length: 9 }, (_, i) => 8 - i).map((i) => <span key={i} className={`ocean-dot ${i < s.oceans ? 'on' : ''}`} />)}
        </div>
        <div className="gauge-name">Oceans</div>
      </div>
    </div>
  );
}
