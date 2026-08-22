import { defineFrontComponent } from 'searm-sdk/define';
import {
  VisibilityHidden,
  VisibilityHiddenInput,
} from 'searm-ui/accessibility';
import { ThemeProvider } from 'searm-ui/theme-constants';
import {
  H1Title,
  H1TitleFontColor,
  H2Title,
  H3Title,
  Label,
  LinkifiedText,
  SeparatorLineText,
  StyledText,
  StyledTextContent,
  StyledTextWrapper,
} from 'searm-ui/typography';

import {
  ComponentGallery,
  type GalleryEntry,
} from '../shared/front-components/component-gallery';

const TYPOGRAPHY_ENTRIES: GalleryEntry[] = [
  {
    name: 'H1Title',
    node: <H1Title title="Heading 1" fontColor={H1TitleFontColor.Primary} />,
  },
  {
    name: 'H2Title',
    node: <H2Title title="Heading 2" />,
  },
  {
    name: 'H3Title',
    node: <H3Title title="Heading 3" />,
  },
  {
    name: 'Label',
    node: <Label variant="default">Label</Label>,
  },
  {
    name: 'LinkifiedText',
    node: <LinkifiedText text="Visit https://searm.com now" />,
  },
  {
    name: 'SeparatorLineText',
    node: <SeparatorLineText>or</SeparatorLineText>,
  },
  {
    name: 'StyledText',
    node: <StyledText text="Styled text" />,
  },
  {
    name: 'StyledTextContent',
    node: <StyledTextContent>Content</StyledTextContent>,
  },
  {
    name: 'StyledTextWrapper',
    node: <StyledTextWrapper>Wrapper</StyledTextWrapper>,
  },
  {
    name: 'VisibilityHidden',
    node: <VisibilityHidden>Screen-reader only</VisibilityHidden>,
  },
  {
    name: 'VisibilityHiddenInput',
    node: <VisibilityHiddenInput readOnly value="" />,
  },
];

const TypographyGallery = () => (
  <ThemeProvider colorScheme="light">
    <ComponentGallery
      title="searm-ui/typography + accessibility"
      entries={TYPOGRAPHY_ENTRIES}
    />
  </ThemeProvider>
);

export default defineFrontComponent({
  universalIdentifier: 'test-20ui0-0000-0000-0000-000000000104',
  name: 'searm-ui-typography-gallery',
  description:
    'Renders every searm-ui/typography and accessibility component in the sandbox',
  component: TypographyGallery,
});
