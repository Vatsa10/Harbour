import { type Decorator } from '@storybook/react-vite';
import { IconsProvider } from 'searm-ui/icon';

export const IconsProviderDecorator: Decorator = (Story) => {
  return (
    <IconsProvider>
      <Story />
    </IconsProvider>
  );
};
