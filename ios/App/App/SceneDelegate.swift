import UIKit
import WebKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        let bridgeViewController = CAPBridgeViewController()
        bridgeViewController.loadViewIfNeeded()
        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = bridgeViewController
        window?.makeKeyAndVisible()

        // The app loads its pages from the server; cover the wait with an animated loading screen
        if let window = window, let webView = bridgeViewController.webView {
            let overlay = LoadingOverlay(webView: webView, frame: window.bounds)
            overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            window.addSubview(overlay)
        }

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// Loading screen shown over the web view until the first page has loaded.
/// It starts identical to the launch screen (same Splash image), so the handover
/// is seamless, then the logo breathes, a progress bar follows the real page load,
/// and it zooms away into the app when the page is ready.
final class LoadingOverlay: UIView {
    private let splash = UIImageView(image: UIImage(named: "Splash"))
    private let track = UIView()
    private let bar = CAGradientLayer()
    private let label = UILabel()

    private var observations: [NSKeyValueObservation] = []
    private var timer: Timer?
    private var startedAt = Date()
    private var realProgress: CGFloat = 0
    private var shownProgress: CGFloat = 0
    private var sawLoading = false
    private var finished = false

    private let trackWidth: CGFloat = 140

    init(webView: WKWebView, frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = UIColor(red: 0.12, green: 0.15, blue: 0.19, alpha: 1)

        splash.contentMode = .scaleAspectFill
        splash.frame = bounds
        splash.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        addSubview(splash)

        track.backgroundColor = UIColor(white: 1, alpha: 0.12)
        track.layer.cornerRadius = 1.5
        track.clipsToBounds = true
        track.alpha = 0
        addSubview(track)

        bar.colors = [
            UIColor(red: 0.90, green: 0.22, blue: 0.27, alpha: 1).cgColor,  // ketchup
            UIColor(red: 0.96, green: 0.64, blue: 0.00, alpha: 1).cgColor   // mustard
        ]
        bar.startPoint = CGPoint(x: 0, y: 0.5)
        bar.endPoint = CGPoint(x: 1, y: 0.5)
        track.layer.addSublayer(bar)

        label.font = .systemFont(ofSize: 13, weight: .semibold)
        label.textColor = UIColor(white: 1, alpha: 0.55)
        label.textAlignment = .center
        label.numberOfLines = 2
        label.alpha = 0
        addSubview(label)

        observations.append(webView.observe(\.estimatedProgress, options: [.initial, .new]) { [weak self] webView, _ in
            DispatchQueue.main.async { self?.realProgress = CGFloat(webView.estimatedProgress) }
        })
        observations.append(webView.observe(\.isLoading, options: [.initial, .new]) { [weak self] webView, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if webView.isLoading { self.sawLoading = true } else if self.sawLoading { self.finish() }
            }
        })

        startBreathing()
        UIView.animate(withDuration: 0.4, delay: 0.3, options: [.curveEaseOut]) { self.track.alpha = 1 }

        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30, repeats: true) { [weak self] _ in self?.tick() }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func layoutSubviews() {
        super.layoutSubviews()
        // Below the logo, which sits in the middle of the splash image
        track.frame = CGRect(x: (bounds.width - trackWidth) / 2, y: bounds.midY + 70, width: trackWidth, height: 3)
        label.frame = CGRect(x: 24, y: track.frame.maxY + 16, width: bounds.width - 48, height: 40)
        updateBar()
    }

    private func startBreathing() {
        let pulse = CABasicAnimation(keyPath: "transform.scale")
        pulse.fromValue = 1.0
        pulse.toValue = 1.04
        pulse.duration = 1.2
        pulse.autoreverses = true
        pulse.repeatCount = .infinity
        pulse.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        splash.layer.add(pulse, forKey: "breathe")
    }

    private func tick() {
        let elapsed = CGFloat(Date().timeIntervalSince(startedAt))
        // Keep the bar creeping forward even before the network reports progress
        let target = max(realProgress, min(0.85, 0.1 + elapsed * 0.12))
        shownProgress += (target - shownProgress) * 0.15
        updateBar()

        if elapsed > 6 && label.alpha == 0 {
            label.text = "Still loading…\nCheck your internet connection"
            UIView.animate(withDuration: 0.3) { self.label.alpha = 1 }
        }
        // Never keep the app covered: whatever the web view shows, show it
        if elapsed > 25 { finish() }
    }

    private func updateBar() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        bar.frame = CGRect(x: 0, y: 0, width: trackWidth * min(1, shownProgress), height: 3)
        CATransaction.commit()
    }

    private func finish() {
        guard !finished else { return }
        finished = true
        timer?.invalidate()
        observations.removeAll()

        shownProgress = 1
        updateBar()
        splash.layer.removeAnimation(forKey: "breathe")

        UIView.animate(withDuration: 0.45, delay: 0.15, options: [.curveEaseIn]) {
            self.alpha = 0
            self.splash.transform = CGAffineTransform(scaleX: 1.15, y: 1.15)
            self.track.alpha = 0
            self.label.alpha = 0
        } completion: { _ in
            self.removeFromSuperview()
        }
    }
}
