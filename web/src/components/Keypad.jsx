import React from 'react';

export default function Keypad({ onDigitPress, onClear, onDelete }) {
  const digits = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['C', '0', '⌫']
  ];

  const handlePress = (key) => {
    if (navigator.vibrate) {
      try {
        navigator.vibrate(50);
      } catch (e) {
        // Safe catch for browsers blocking or not supporting vibration
      }
    }

    if (key === 'C') {
      onClear();
    } else if (key === '⌫') {
      onDelete();
    } else {
      onDigitPress(key);
    }
  };

  return (
    <div className="grid grid-cols-3 gap-3 max-w-[280px] mx-auto">
      {digits.flat().map((key) => {
        const isAction = key === 'C' || key === '⌫';
        return (
          <button
            key={key}
            type="button"
            onClick={() => handlePress(key)}
            className={`h-[60px] flex items-center justify-center text-xl font-bold rounded-xl active:scale-95 transition-transform duration-100 border select-none ${
              isAction
                ? 'bg-slate-800 text-slate-400 border-slate-700 active:bg-slate-700'
                : 'bg-slate-700 text-white border-slate-600 active:bg-slate-600'
            }`}
          >
            {key}
          </button>
        );
      })}
    </div>
  );
}
