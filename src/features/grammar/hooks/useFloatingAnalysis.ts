import { useCallback, useState } from 'react'

function copyStylesToWindow(targetWindow: Window) {
  const styles = document.querySelectorAll(
    'style, link[rel="stylesheet"]',
  )

  styles.forEach((style) => {
    targetWindow.document.head.appendChild(style.cloneNode(true))
  })
}

export function useFloatingAnalysis() {
  const [pipWindow, setPipWindow] = useState<Window | null>(null)

  const supported =
    typeof window !== 'undefined' &&
    'documentPictureInPicture' in window

  const open = useCallback(async () => {
    if (!window.documentPictureInPicture) {
      return
    }

    if (window.documentPictureInPicture.window) {
      setPipWindow(window.documentPictureInPicture.window)
      return
    }

    const win =
      await window.documentPictureInPicture.requestWindow({
        width: 560,
        height: 760,
      })

    win.document.title = 'Paper Grammar Tutor'
    copyStylesToWindow(win)
    const floatingStyle = win.document.createElement('style')

    floatingStyle.textContent = `
    body {
        margin: 0;
        padding: 16px;
        box-sizing: border-box;
    }
    `

    win.document.head.appendChild(floatingStyle)

    setPipWindow(win)

    win.addEventListener(
      'pagehide',
      () => {
        setPipWindow(null)
      },
      { once: true },
    )
  }, [])

  const close = useCallback(() => {
    pipWindow?.close()
    setPipWindow(null)
  }, [pipWindow])

  return {
    supported,
    pipWindow,
    isFloating: pipWindow !== null,
    open,
    close,
  }
}