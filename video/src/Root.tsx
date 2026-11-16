import { Composition, Folder } from "remotion";
import { DownyPromo } from "./DownyPromo";
import { Browse } from "./scenes/Browse";
import { Features } from "./scenes/Features";
import { Intro } from "./scenes/Intro";
import { ManagerScene } from "./scenes/ManagerScene";
import { Outro } from "./scenes/Outro";
import { TOTAL } from "./theme";
import { DownySetup, SETUP, SETUP_TOTAL } from "./DownySetup";
import { CLIPS, StepClip, clipLength } from "./setup/Clips";
import { AddExtension } from "./setup/scenes/AddExtension";
import { FirstStart } from "./setup/scenes/FirstStart";
import { GetDowny } from "./setup/scenes/GetDowny";
import { SetupIntro } from "./setup/scenes/SetupIntro";
import { SetupOutro } from "./setup/scenes/SetupOutro";
import { TryIt } from "./setup/scenes/TryIt";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="DownyPromo" component={DownyPromo} width={1920} height={1080} fps={30} durationInFrames={TOTAL} />
    <Composition id="DownySetup" component={DownySetup} width={1920} height={1080} fps={30} durationInFrames={SETUP_TOTAL} />
    <Folder name="Scenes">
      <Composition id="Intro" component={Intro} width={1920} height={1080} fps={30} durationInFrames={165} />
      <Composition id="Browse" component={Browse} width={1920} height={1080} fps={30} durationInFrames={345} />
      <Composition id="Manager" component={ManagerScene} width={1920} height={1080} fps={30} durationInFrames={300} />
      <Composition id="Features" component={Features} width={1920} height={1080} fps={30} durationInFrames={240} />
      <Composition id="Outro" component={Outro} width={1920} height={1080} fps={30} durationInFrames={165} />
    </Folder>
    <Folder name="Setup-Scenes">
      <Composition id="SetupIntro" component={SetupIntro} width={1920} height={1080} fps={30} durationInFrames={SETUP.intro} />
      <Composition id="GetDowny" component={GetDowny} width={1920} height={1080} fps={30} durationInFrames={SETUP.get} />
      <Composition id="FirstStart" component={FirstStart} width={1920} height={1080} fps={30} durationInFrames={SETUP.first} />
      <Composition id="AddExtension" component={AddExtension} width={1920} height={1080} fps={30} durationInFrames={SETUP.ext} />
      <Composition id="TryIt" component={TryIt} width={1920} height={1080} fps={30} durationInFrames={SETUP.tryIt} />
      <Composition id="SetupOutro" component={SetupOutro} width={1920} height={1080} fps={30} durationInFrames={SETUP.outro} />
    </Folder>
    <Folder name="Setup-Clips">
      {CLIPS.map(({ id, ...clip }) => (
        <Composition key={id} id={`clip-${id}`} component={StepClip} width={1920} height={1080} fps={30} durationInFrames={clipLength(clip)} defaultProps={clip} />
      ))}
    </Folder>
  </>
);
