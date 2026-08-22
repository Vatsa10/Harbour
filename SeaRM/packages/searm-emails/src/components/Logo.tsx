import { Img } from 'react-email';

const logoStyle = {
  marginBottom: '40px',
};

export const Logo = () => {
  return (
    <Img
      src="https://app.searm.com/images/icons/windows11/Square150x150Logo.scale-100.png"
      alt="SeaRM logo"
      width="40"
      height="40"
      style={logoStyle}
    />
  );
};
