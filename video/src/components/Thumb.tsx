import { rand } from "../anim";

export const VIDEOS = [
  { title: "Driving through Tokyo at night in 4K", channel: "Neon Roads", views: "2.1M views", age: "3 weeks ago", len: "48:12" },
  { title: "Sunrise above the Dolomites, a 4K drone film", channel: "Altitude", views: "864K views", age: "5 days ago", len: "12:41" },
  { title: "Lofi beats to code and relax to", channel: "Quiet Hours", views: "12M views", age: "1 year ago", len: "3:02:15" },
  { title: "Learn any song on piano in 10 minutes", channel: "Keys with Mara", views: "1.4M views", age: "2 months ago", len: "10:08" },
  { title: "A street food night in Bangkok", channel: "Hungry Atlas", views: "3.3M views", age: "8 months ago", len: "22:37" },
  { title: "How deep is the ocean, really?", channel: "Deep Blue Lab", views: "9.8M views", age: "1 year ago", len: "15:54" },
  { title: "Sourdough from scratch, the easy way", channel: "Slow Bread", views: "640K views", age: "4 days ago", len: "18:20" },
  { title: "Synthwave for late night drives", channel: "Retrograde FM", views: "5.2M views", age: "6 months ago", len: "1:14:03" },
];

// Generated cover art for each made-up video. `t` animates it (the playing video uses it).
export const Art: React.FC<{ v: number; t?: number; style?: React.CSSProperties }> = ({ v, t = 0, style }) => {
  const s: React.CSSProperties = { display: "block", width: "100%", height: "100%", ...style };
  const id = `a${v}`;
  switch (v) {
    case 0:
      return (
        <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" style={s}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#0b1033" />
              <stop offset="1" stopColor="#3a1450" />
            </linearGradient>
          </defs>
          <rect width="320" height="180" fill={`url(#${id})`} />
          {Array.from({ length: 14 }).map((_, i) => {
            const h = 40 + rand(i) * 90;
            return <rect key={i} x={i * 24 - 6} y={150 - h} width={20} height={h} fill="#0d0b26" />;
          })}
          {Array.from({ length: 60 }).map((_, i) => (
            <rect key={i} x={rand(i + 3) * 320} y={40 + rand(i + 9) * 100} width="3" height="3" fill={rand(i) > 0.5 ? "#ffd27a" : "#7af0ff"} opacity={0.8} />
          ))}
          <rect y="150" width="320" height="30" fill="#140f2c" />
          <path d="M160 150 L60 180 M160 150 L260 180" stroke="#ff4fa3" strokeWidth="2" />
        </svg>
      );
    case 1: {
      const rise = t * 26;
      return (
        <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" style={s}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#2a2a78" />
              <stop offset="0.55" stopColor={`color-mix(in srgb, #ff8a8a ${60 + t * 30}%, #8a5ac8)`} />
              <stop offset="1" stopColor="#ffd08a" />
            </linearGradient>
            <radialGradient id={id + "s"}>
              <stop offset="0" stopColor="#fff6dc" />
              <stop offset="0.35" stopColor="#ffd9a0" stopOpacity="0.9" />
              <stop offset="1" stopColor="#ffb07a" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width="320" height="180" fill={`url(#${id})`} />
          <circle cx={200} cy={118 - rise} r={56} fill={`url(#${id + "s"})`} />
          <path d={`M0 128 L40 92 L70 110 L110 60 L150 104 L190 74 L230 112 L270 80 L320 118 V180 H0Z`} fill="#6a4a9a" opacity="0.75" transform={`translate(${-t * 8} 0)`} />
          <path d="M-20 150 L30 110 L64 132 L104 96 L150 140 L196 104 L240 140 L290 112 L340 146 V180 H-20Z" fill="#3b2a6a" transform={`translate(${-t * 16} 0)`} />
          <path d="M-20 170 L40 140 L90 160 L140 136 L200 166 L260 142 L340 168 V180 H-20Z" fill="#1c1640" transform={`translate(${-t * 28} 0)`} />
        </svg>
      );
    }
    case 2:
      return (
        <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" style={s}>
          <rect width="320" height="180" fill="#3b2a6e" />
          <rect x="190" y="26" width="96" height="76" rx="6" fill="#20185a" />
          <circle cx="250" cy="56" r="14" fill="#ffe6b0" />
          <rect x="0" y="122" width="320" height="58" fill="#24183f" />
          <rect x="40" y="96" width="120" height="30" rx="4" fill="#ff9e7a" />
          <rect x="70" y="76" width="70" height="22" rx="3" fill="#8fdcc0" />
          <circle cx="210" cy="118" r="12" fill="#e0648f" />
        </svg>
      );
    case 3:
      return (
        <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" style={s}>
          <rect width="320" height="180" fill="#151320" />
          {Array.from({ length: 14 }).map((_, i) => (
            <rect key={i} x={10 + i * 22} y="60" width="20" height="110" rx="2" fill="#f4f1ea" />
          ))}
          {[0, 1, 3, 4, 5, 7, 8, 10, 11, 12].map((i) => (
            <rect key={i} x={24 + i * 22} y="60" width="13" height="66" rx="2" fill="#151320" />
          ))}
          <rect x="0" y="0" width="320" height="56" fill="#2a1f44" />
        </svg>
      );
    case 4:
      return (
        <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" style={s}>
          <rect width="320" height="180" fill="#3a1608" />
          {Array.from({ length: 22 }).map((_, i) => (
            <circle key={i} cx={rand(i) * 320} cy={rand(i + 5) * 120} r={8 + rand(i + 2) * 22} fill={["#ff9b3d", "#ffcf5a", "#ff5d5d"][i % 3]} opacity={0.35} />
          ))}
          <ellipse cx="160" cy="150" rx="110" ry="30" fill="#1a0b05" />
          <ellipse cx="160" cy="142" rx="80" ry="16" fill="#e8a24a" />
        </svg>
      );
    case 5:
      return (
        <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" style={s}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#1f6fb8" />
              <stop offset="1" stopColor="#020a24" />
            </linearGradient>
          </defs>
          <rect width="320" height="180" fill={`url(#${id})`} />
          {[0, 1, 2, 3].map((i) => (
            <path key={i} d={`M0 ${40 + i * 14} Q80 ${30 + i * 14} 160 ${40 + i * 14} T320 ${40 + i * 14}`} stroke="#9fd8ff" strokeOpacity={0.3 - i * 0.06} fill="none" strokeWidth="2" />
          ))}
          <path d="M120 120 q20 -14 40 0 q-20 10 -40 0 l-10 -8 v16z" fill="#0a1f44" />
        </svg>
      );
    case 6:
      return (
        <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" style={s}>
          <rect width="320" height="180" fill="#e9d8bd" />
          <rect y="120" width="320" height="60" fill="#8a5a36" />
          <ellipse cx="160" cy="110" rx="90" ry="46" fill="#c7843f" />
          <path d="M100 100 q60 -30 120 0" stroke="#f6e1b8" strokeWidth="5" fill="none" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" style={s}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#14082e" />
              <stop offset="0.6" stopColor="#5a1a6a" />
            </linearGradient>
            <linearGradient id={id + "s"} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffd36a" />
              <stop offset="1" stopColor="#ff3f8e" />
            </linearGradient>
          </defs>
          <rect width="320" height="180" fill={`url(#${id})`} />
          <circle cx="160" cy="96" r="50" fill={`url(#${id + "s"})`} />
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x="100" y={92 + i * 12} width="120" height={3 + i} fill="#5a1a6a" />
          ))}
          <rect y="112" width="320" height="68" fill="#1a0838" />
          {Array.from({ length: 9 }).map((_, i) => (
            <path key={i} d={`M160 112 L${-200 + i * 90} 180`} stroke="#ff3fd0" strokeOpacity="0.6" />
          ))}
        </svg>
      );
  }
};
