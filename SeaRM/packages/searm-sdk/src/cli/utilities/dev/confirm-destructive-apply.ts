import chalk from 'chalk';
import inquirer from 'inquirer';

export const confirmDestructiveApply = async (
  deleteCount: number,
  { force }: { force?: boolean },
): Promise<boolean> => {
  if (force) {
    return true;
  }

  if (!process.stdout.isTTY) {
    console.error(
      chalk.red(
        `${deleteCount} destructive change(s) detected. Run \`yarn searm plan\` to review them, or re-run with --force to apply non-interactively.`,
      ),
    );

    return false;
  }

  const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
    {
      type: 'confirm',
      name: 'confirmed',
      message: `SeaRM will DESTROY ${deleteCount} metadata entity(ies) (run \`yarn searm plan\` for details). Do you want to perform these actions?`,
      default: false,
    },
  ]);

  return confirmed;
};
