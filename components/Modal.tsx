
import React, { useEffect } from 'react';

interface ModalProps {
  onClose: () => void;
  children: React.ReactNode;
  fullScreen?: boolean; // New prop for media viewer
  noScroll?: boolean; // New prop to disable internal scroll
}

const Modal: React.FC<ModalProps> = ({ onClose, children, fullScreen = false, noScroll = false }) => {
  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  if (fullScreen) {
    return (
      <div
        className="fixed inset-0 bg-black z-50 flex justify-center items-center overflow-hidden"
        onClick={onClose}
      >
        <div
          className="relative w-full h-full flex items-center justify-center"
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-white/70 hover:text-white bg-black/50 rounded-full w-10 h-10 flex items-center justify-center text-2xl z-50 backdrop-blur-sm"
            aria-label="Fechar"
          >
            &times;
          </button>
          {children}
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 bg-black/75 flex justify-center items-center z-50 p-2 sm:p-4 overflow-x-hidden overscroll-none"
      onClick={onClose}
    >
      <div
        className={`bg-white rounded-2xl shadow-2xl relative w-full max-w-4xl max-h-[95vh] overflow-x-hidden overscroll-contain ${
          noScroll ? 'overflow-hidden flex flex-col' : 'overflow-y-auto p-4 sm:p-6'
        }`}
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-2 right-2 sm:-top-3 sm:-right-3 bg-slate-700 text-white rounded-full w-8 h-8 flex items-center justify-center text-xl font-bold hover:bg-red-600 transition-colors z-[60]"
          aria-label="Fechar modal"
        >
          &times;
        </button>
        {children}
      </div>
    </div>
  );
};

export default Modal;
