import { type JSONContent, reactMarkupFromJSON, render } from 'searm-emails';

export const renderRichTextToHtml = async (
  jsonContent: JSONContent,
): Promise<string> => {
  const reactMarkup = reactMarkupFromJSON(jsonContent);

  return render(reactMarkup);
};
