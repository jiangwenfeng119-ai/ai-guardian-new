import { memo } from 'react';
import { cn } from '../lib/utils';
import zhaoxunLogo from '../assets/zhaoxun-logo.png';

type AppLogoProps = {
  className?: string;
};

/** 昭讯 / 产品共用 Logo（与登录页同源资源） */
function AppLogo({ className }: AppLogoProps) {
  return (
    <img
      src={zhaoxunLogo}
      alt="昭讯信息 Zhaoxun Technology"
      decoding="async"
      className={cn('object-contain shrink-0 select-none', className)}
      draggable={false}
    />
  );
}

export default memo(AppLogo);
