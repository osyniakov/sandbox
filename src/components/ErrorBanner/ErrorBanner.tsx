import './ErrorBanner.css'

interface ErrorBannerProps {
  message: string
}

export function ErrorBanner({ message }: ErrorBannerProps) {
  const lines = message.split('\n')
  return (
    <div className="error-banner" role="alert">
      <div className="error-banner__icon">&#9888;</div>
      <div className="error-banner__body">
        <strong className="error-banner__title">yFiles not available</strong>
        {lines.map((line, i) => (
          <p key={i} className="error-banner__line">{line}</p>
        ))}
        <a
          className="error-banner__link"
          href="https://my.yworks.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Get yFiles Evaluation License →
        </a>
      </div>
    </div>
  )
}
