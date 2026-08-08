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
});
