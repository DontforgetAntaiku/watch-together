import type { ReactNode } from 'react'
import { LangSwitch } from '../LangSwitch/LangSwitch'
import { Logo } from '../Logo/Logo'
import './Header.css'

type Props = {
  /** Shown next to the logo (e.g. who is in the room). */
  children?: ReactNode
  /** Extra controls before the language switch (e.g. the install button). */
  tools?: ReactNode
}

/** The top bar of every page, so the logo and the language switch are always in the same place. */
export function Header({ children, tools }: Props) {
  return (
    <header className="header">
      <Logo />
      {children}
      <div className="header__tools">
        {tools}
        <LangSwitch />
      </div>
    </header>
  )
}
