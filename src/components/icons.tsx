import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export function MicIcon(props: IconProps) {
  return <Icon {...props}><path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 18.75a6 6 0 0 0 6-6v-1.5a6 6 0 0 0-12 0v1.5a6 6 0 0 0 6 6Zm0 0v3.75m-3.75 0h7.5M8.25 9.75v3a3.75 3.75 0 0 0 7.5 0v-3" /></Icon>;
}

export function SettingsIcon(props: IconProps) {
  return <Icon {...props}><path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" /><path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></Icon>;
}

export function ArrowUpRightIcon(props: IconProps) {
  return <Icon {...props}><path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></Icon>;
}

export function ArrowLeftIcon(props: IconProps) {
  return <Icon {...props}><path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></Icon>;
}

export function ArrowRightIcon(props: IconProps) {
  return <Icon {...props}><path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" /></Icon>;
}

export function HelpIcon(props: IconProps) {
  return <Icon {...props}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" /><path stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" d="M9.75 9a2.25 2.25 0 1 1 3.728 1.694c-.822.696-1.478 1.15-1.478 2.556M12 16.5h.008" /></Icon>;
}

export function MusicIcon(props: IconProps) {
  return <Icon {...props}><path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="m9 9 10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163ZM19.5 12.553V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z" /></Icon>;
}

export function ImageIcon(props: IconProps) {
  return <Icon {...props}><path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" /></Icon>;
}

export function DocumentIcon(props: IconProps) {
  return <Icon {...props}><path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></Icon>;
}

export function QuestionMarkIcon(props: IconProps) {
  return <Icon {...props}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" /><path stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" d="M9.75 9a2.25 2.25 0 1 1 3.728 1.694c-.822.696-1.478 1.15-1.478 2.556M12 16.5h.008" /></Icon>;
}

export function CloseIcon(props: IconProps) {
  return <Icon {...props}><path stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" d="M6 18 18 6M6 6l12 12" /></Icon>;
}

export function DotIcon(props: IconProps) {
  return <svg viewBox="0 0 8 8" aria-hidden="true" {...props}><circle cx="4" cy="4" r="3" fill="currentColor" /></svg>;
}
