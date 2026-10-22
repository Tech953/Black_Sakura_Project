import { Bullet, SlideShell, SlideTitle } from "../../components/SlidePrimitives";

export default function DeepOffline() {
  return (
    <SlideShell number="24" section="SURFACES / 23">
      <div className="px-[8vw] pt-[14vh]">
        <SlideTitle eyebrow="OFFLINE PRESENCE">Offline mode preserves presence without the network</SlideTitle>
        <div className="mt-[6vh] max-w-[78vw]">
          <Bullet number="01">Conversation history stays on the device</Bullet>
          <Bullet number="02">The same engram identity and safety seam remain active</Bullet>
          <Bullet number="03">A local model can stream an in-voice response</Bullet>
          <Bullet number="04">Reconciliation can upload durable history later</Bullet>
          <Bullet number="05" amber>Offline is a mode of the relationship, not a separate product</Bullet>
        </div>
      </div>
    </SlideShell>
  );
}