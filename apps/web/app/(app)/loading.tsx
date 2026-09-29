import { ParticleLoader } from "@/features/q-swarm/particle-loader";

/** Every page of the app, while it loads: Q's swarm, centred. */
export default function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <ParticleLoader size={72} />
    </div>
  );
}
