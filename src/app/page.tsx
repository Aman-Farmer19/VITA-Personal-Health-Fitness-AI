import dynamic from 'next/dynamic';

// Dynamically import VitaOrb — disables SSR for Three.js
const VitaOrb = dynamic(() => import('@/components/VitaOrb'), { ssr: false });

export default function Home() {
  return <VitaOrb />;
}
