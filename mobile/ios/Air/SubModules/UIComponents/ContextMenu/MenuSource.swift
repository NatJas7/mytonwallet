
import UIKit
import SwiftUI


extension View {
    @ViewBuilder
    public func menuSource(
        isEnabled: Bool = true,
        isTapGestureEnabled: Bool = true,
        isHoldAndDragGestureEnabled: Bool = true,
        coordinateSpace: CoordinateSpace = .global,
        menuContext: MenuContext?,
        /// Extra insets to be added to menu.sourceFrame calculated via menu.onGetSourceFrame
        edgeInsets: UIEdgeInsets = .zero
    ) -> some View {
        if let menuContext, isEnabled {
            modifier(
                MenuSourceViewModifier(
                    coordinateSpace: coordinateSpace,
                    menuContext: menuContext,
                    isTapGestureEnabled: isTapGestureEnabled,
                    isHoldAndDragGestureEnabled: isHoldAndDragGestureEnabled,
                    edgeInsets: edgeInsets,
                )
            )
        } else {
            self
        }
    }
}

private struct MenuSourceViewModifier: ViewModifier {
    let coordinateSpace: CoordinateSpace
    let menuContext: MenuContext
    let isTapGestureEnabled: Bool
    let isHoldAndDragGestureEnabled: Bool
    let edgeInsets: UIEdgeInsets
        
    func body(content: Content) -> some View {
        content
            .padding(8)
            .contentShape(.rect)
            .gesture(tapGesture, isEnabled: isTapGestureEnabled)
            .holdAndDragGesture(
                isEnabled: isHoldAndDragGestureEnabled,
                onBegan: { _ in
                    menuContext.present()
                },
                onChanged: { point in
                    menuContext.present()
                    menuContext.update(location: point)
                },
                onEnded: {
                    menuContext.triggerCurrentAction()
                }
            )
            .padding(-8)
            .background(FrameReportingView(menuContext: menuContext, edgeInsets: edgeInsets))
    }
    
    var tapGesture: some Gesture {
        TapGesture().onEnded({
            showMenu()
        })
    }
    
    func showMenu() {
        menuContext.present()
    }
}

/// Registers a menuContext.getSourceFrame closure to resolve frame in window coords at menu.present() time.
/// This works more reliable than .onGeometryChange().
private struct FrameReportingView: UIViewRepresentable {
    let menuContext: MenuContext
    let edgeInsets: UIEdgeInsets

    func makeUIView(context: Context) -> UIView { _FrameReportingUIView(menuContext: menuContext, edgeInsets: edgeInsets) }
    func updateUIView(_ uiView: UIView, context: Context) { (uiView as? _FrameReportingUIView)?.menuContext = menuContext }
}

private final class _FrameReportingUIView: UIView {
    weak var menuContext: MenuContext?
    let edgeInsets: UIEdgeInsets
    
    init(menuContext: MenuContext?, edgeInsets: UIEdgeInsets) {
        self.menuContext = menuContext
        self.edgeInsets = edgeInsets
        super.init(frame: .zero)
        backgroundColor = .clear
        isUserInteractionEnabled = false
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
    
    override func didMoveToWindow() {
        super.didMoveToWindow()
                
        // There can be a few views for the same menu context on the screen at a moment
        // We will only respect (i.e., set the handler for) the last one, which effectively resign the former ones
        if window != nil {
            menuContext?.onGetSourceFrame = { [weak self] in
                guard let self, window != nil, !bounds.isEmpty else { return nil }
                return convert(bounds.inset(by: edgeInsets), to: nil)
            }
        }
    }
}
