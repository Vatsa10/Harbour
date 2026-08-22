import { type I18n } from '@lingui/core';
import { MainText } from 'src/components/MainText';
import { SubTitle } from 'src/components/SubTitle';

type WhatIsSeaRMProps = {
  i18n: I18n;
};

export const WhatIsSeaRM = ({ i18n }: WhatIsSeaRMProps) => {
  return (
    <>
      <SubTitle value={i18n._('What is SeaRM?')} />
      <MainText>
        {i18n._(
          "It's a CRM, a software to help businesses manage their customer data and relationships efficiently.",
        )}
      </MainText>
    </>
  );
};
