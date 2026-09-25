export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');

export function timeAgo(iso: string) {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  if (s < 604800) return `há ${Math.floor(s / 86400)} d`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** "Hoje 14:30", "Amanhã 09:00", "12/10 09:00" ou "Atrasada há 2 h". */
export function dueLabel(iso: string | null, done = false): { text: string; late: boolean } {
  if (!iso) return { text: 'Sem prazo', late: false };
  const d = new Date(iso);
  const late = !done && d.getTime() < Date.now();
  if (late) return { text: `Atrasada ${timeAgo(iso)}`, late: true };
  const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const diff = Math.floor((new Date(d).setHours(0, 0, 0, 0) - day.getTime()) / 86_400_000);
  if (diff === 0) return { text: `Hoje ${hm}`, late: false };
  if (diff === 1) return { text: `Amanhã ${hm}`, late: false };
  return { text: `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hm}`, late: false };
}

/** Valor para <input type="datetime-local"> a partir de um ISO. */
export const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export function formatPhone(d: string | null | undefined) {
  if (!d) return '';
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : d;
}
