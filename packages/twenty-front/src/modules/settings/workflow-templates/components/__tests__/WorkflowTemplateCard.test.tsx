import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { WorkflowTemplateCard } from '@/settings/workflow-templates/components/WorkflowTemplateCard';

describe('WorkflowTemplateCard', () => {
  it('should show the template name and description', () => {
    render(
      <WorkflowTemplateCard
        template={{
          key: 'RESEARCH_BRIEF',
          name: 'Research brief',
          description: 'Researches a company or person on demand.',
        }}
        onInstall={jest.fn()}
      />,
    );

    expect(screen.getByText('Research brief')).toBeInTheDocument();
    expect(
      screen.getByText('Researches a company or person on demand.'),
    ).toBeInTheDocument();
  });

  it('should call onInstall with the template key when clicked', async () => {
    const onInstall = jest.fn();

    render(
      <WorkflowTemplateCard
        template={{
          key: 'RESEARCH_BRIEF',
          name: 'Research brief',
          description: 'Researches a company or person on demand.',
        }}
        onInstall={onInstall}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /install/i }));

    expect(onInstall).toHaveBeenCalledWith('RESEARCH_BRIEF');
  });

  it('should disable the button and report progress while installing', async () => {
    const onInstall = jest.fn();

    render(
      <WorkflowTemplateCard
        template={{
          key: 'RESEARCH_BRIEF',
          name: 'Research brief',
          description: 'Researches a company or person on demand.',
        }}
        onInstall={onInstall}
        isInstalling
      />,
    );

    const button = screen.getByRole('button', { name: /installing/i });

    expect(button).toBeDisabled();

    await userEvent.click(button);

    expect(onInstall).not.toHaveBeenCalled();
  });

  it('should not offer a second install once the template is installed', async () => {
    const onInstall = jest.fn();

    render(
      <WorkflowTemplateCard
        template={{
          key: 'RESEARCH_BRIEF',
          name: 'Research brief',
          description: 'Researches a company or person on demand.',
        }}
        onInstall={onInstall}
        isInstalled
      />,
    );

    const button = screen.getByRole('button', { name: /installed/i });

    expect(button).toBeDisabled();

    await userEvent.click(button);

    expect(onInstall).not.toHaveBeenCalled();
  });
});
