import dynamic from 'next/dynamic';
import VitaSessionController from '@/components/VitaSessionController';

// Dynamically import VitaOrb — disables SSR for Three.js
const VitaOrb = dynamic(() => import('@/components/VitaOrb'), { ssr: false });

export default function Home() {
  return (
    <>
      <VitaOrb />
      {/* Keep the wake/session controller in the initial client bundle so the
          passive "Hello Vita" listener starts as soon as the page mounts. */}
      <VitaSessionController />
    </>
  );
}
