import { Composition, Folder } from "remotion";
import { DownyPromo } from "./DownyPromo";
import { Browse } from "./scenes/Browse";
import { Features } from "./scenes/Features";
import { Intro } from "./scenes/Intro";
import { ManagerScene } from "./scenes/ManagerScene";
import { Outro } from "./scenes/Outro";
import { TOTAL } from "./theme";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="DownyPromo" component={DownyPromo} width={1920} height={1080} fps={30} durationInFrames={TOTAL} />
    <Folder name="Scenes">
      <Composition id="Intro" component={Intro} width={1920} height={1080} fps={30} durationInFrames={165} />
      <Composition id="Browse" component={Browse} width={1920} height={1080} fps={30} durationInFrames={345} />
      <Composition id="Manager" component={ManagerScene} width={1920} height={1080} fps={30} durationInFrames={300} />
      <Composition id="Features" component={Features} width={1920} height={1080} fps={30} durationInFrames={240} />
      <Composition id="Outro" component={Outro} width={1920} height={1080} fps={30} durationInFrames={165} />
    </Folder>
  </>
);
