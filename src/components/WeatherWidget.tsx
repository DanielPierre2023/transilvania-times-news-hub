import { useState, useEffect } from "react";
import { Sun, Cloud } from "lucide-react";

const WeatherWidget = () => {
  const [temp, setTemp] = useState<number | null>(null);

  useEffect(() => {
    fetch("https://api.open-meteo.com/v1/forecast?latitude=46.7712&longitude=23.6236&current_weather=true")
      .then((r) => r.json())
      .then((d) => setTemp(Math.round(d.current_weather.temperature)))
      .catch(() => {});
  }, []);

  if (temp === null) return null;

  return (
    <div className="flex items-center gap-3 font-sans text-xs font-bold uppercase tracking-wider text-foreground border-l border-foreground/10 pl-4 ml-4">
      <div className="flex items-center gap-1.5">
        {temp > 15 ? <Sun size={14} className="text-primary" /> : <Cloud size={14} className="text-muted-foreground" />}
        <span>{temp}°C</span>
      </div>
      <span className="text-muted-foreground font-medium hidden sm:inline">Cluj-Napoca</span>
    </div>
  );
};

export default WeatherWidget;
