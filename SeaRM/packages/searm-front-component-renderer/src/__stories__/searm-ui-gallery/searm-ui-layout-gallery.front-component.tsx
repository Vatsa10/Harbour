import { defineFrontComponent } from 'searm-sdk/define';
import { IconHeart, IconStar } from 'searm-ui/icon';
import {
  AnimatedCircleLoading,
  AnimatedContainer,
  AnimatedEaseIn,
  AnimatedEaseInOut,
  AnimatedExpandableContainer,
  AnimatedIconCrossfade,
  AnimatedRotate,
  AutogrowWrapper,
  HorizontalSeparator,
  ResizeHandle,
  Section,
  SectionAlignment,
  SectionFontColor,
} from 'searm-ui/layout';
import { ThemeProvider } from 'searm-ui/theme-constants';

import {
  ComponentGallery,
  type GalleryEntry,
} from '../shared/front-components/component-gallery';

const LAYOUT_ENTRIES: GalleryEntry[] = [
  {
    name: 'AnimatedCircleLoading',
    node: <AnimatedCircleLoading>Loading</AnimatedCircleLoading>,
  },
  {
    name: 'AnimatedContainer',
    node: <AnimatedContainer>Content</AnimatedContainer>,
  },
  {
    name: 'AnimatedEaseIn',
    node: <AnimatedEaseIn>Fades in</AnimatedEaseIn>,
  },
  {
    name: 'AnimatedEaseInOut',
    node: <AnimatedEaseInOut isOpen={true}>Panel</AnimatedEaseInOut>,
  },
  {
    name: 'AnimatedExpandableContainer',
    node: (
      <AnimatedExpandableContainer isExpanded={true}>
        Expandable
      </AnimatedExpandableContainer>
    ),
  },
  {
    name: 'AnimatedIconCrossfade',
    node: (
      <AnimatedIconCrossfade
        isActive={true}
        ActiveIcon={IconStar}
        InactiveIcon={IconHeart}
        size={16}
      />
    ),
  },
  {
    name: 'AnimatedRotate',
    node: <AnimatedRotate>Rotate</AnimatedRotate>,
  },
  {
    name: 'AutogrowWrapper',
    node: <AutogrowWrapper>Grows</AutogrowWrapper>,
  },
  {
    name: 'HorizontalSeparator',
    node: <HorizontalSeparator text="or" />,
  },
  {
    name: 'ResizeHandle',
    node: <ResizeHandle />,
  },
  {
    name: 'Section',
    node: (
      <Section
        alignment={SectionAlignment.Left}
        fontColor={SectionFontColor.Primary}
      >
        Section
      </Section>
    ),
  },
];

const LayoutGallery = () => (
  <ThemeProvider colorScheme="light">
    <ComponentGallery title="searm-ui/layout" entries={LAYOUT_ENTRIES} />
  </ThemeProvider>
);

export default defineFrontComponent({
  universalIdentifier: 'test-20ui0-0000-0000-0000-000000000103',
  name: 'searm-ui-layout-gallery',
  description: 'Renders every searm-ui/layout component in the sandbox',
  component: LayoutGallery,
});
