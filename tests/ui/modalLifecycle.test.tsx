import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Modal } from '../../src/modals/ModalTemplate';
import SelectDropdown from '../../src/components/SelectDropdown';
import { SettingsContext } from '../../src/shared/contexts/settingsContext';
import { defaultAppSettings } from '../../src/shared/types/settings';

function Frame({ children }: { children: React.ReactNode }) {
    return <SettingsContext.Provider value={{ settings: defaultAppSettings, setSettings: vi.fn() }}>{children}</SettingsContext.Provider>;
}

afterEach(() => vi.useRealTimers());

describe('shared modal lifecycle', () => {
    it('labels stacked dialogs separately, dismisses only the top one and restores focus and scroll', () => {
        vi.useFakeTimers();
        const trigger = document.createElement('button');
        document.body.append(trigger);
        trigger.focus();
        document.body.style.overflow = 'auto';
        const lowerClose = vi.fn(), upperClose = vi.fn();
        const lower = render(<Frame><Modal isOpen title="Lower" onClose={lowerClose}><button>Lower action</button></Modal></Frame>);
        const lowerFocus = document.activeElement;
        const upper = render(<Frame><Modal isOpen title="Upper" onClose={upperClose}><button>Upper action</button></Modal></Frame>);
        expect(screen.getByRole('dialog', { name: 'Lower' }).getAttribute('aria-labelledby')).not.toBe(screen.getByRole('dialog', { name: 'Upper' }).getAttribute('aria-labelledby'));
        expect(document.body.style.overflow).toBe('hidden');
        fireEvent.keyDown(window, { key: 'Escape' });
        act(() => vi.advanceTimersByTime(180));
        expect(upperClose).toHaveBeenCalledOnce();
        expect(lowerClose).not.toHaveBeenCalled();
        upper.unmount();
        expect(document.activeElement).toBe(lowerFocus);
        expect(document.body.style.overflow).toBe('hidden');
        lower.unmount();
        expect(document.activeElement).toBe(trigger);
        expect(document.body.style.overflow).toBe('auto');
        document.body.style.overflow = '';
        trigger.remove();
    });

    it('cancels an obsolete close timer when a controlled modal closes and reopens', () => {
        vi.useFakeTimers();
        const onClose = vi.fn(), onCloseStart = vi.fn();
        const view = (open: boolean) => <Frame><Modal isOpen={open} title="Settings" onClose={onClose} onCloseStart={onCloseStart} /></Frame>;
        const { rerender } = render(view(true));
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onCloseStart).toHaveBeenCalledOnce();
        rerender(view(false));
        rerender(view(true));
        act(() => vi.advanceTimersByTime(200));
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    });

    it('keeps keyboard focus inside the modal', () => {
        render(<Frame><Modal isOpen title="Focus" onClose={vi.fn()}><button>Last</button></Modal></Frame>);
        const dialog = screen.getByRole('dialog');
        const buttons = dialog.querySelectorAll('button');
        buttons[buttons.length - 1].focus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(document.activeElement).toBe(buttons[0]);
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    });

    it('lets Escape close an open dropdown before dismissing its modal', () => {
        vi.useFakeTimers();
        const onClose = vi.fn();
        render(<Frame><Modal isOpen title="Dropdown" onClose={onClose}>
            <SelectDropdown value="one" options={[{ value: 'one', label: 'First option' }]} onChange={vi.fn()} ariaLabel="Options" />
        </Modal></Frame>);
        const trigger = screen.getByRole('button', { name: 'First option' });
        fireEvent.click(trigger);
        fireEvent.keyDown(trigger, { key: 'Escape' });
        act(() => vi.advanceTimersByTime(200));
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.keyDown(trigger, { key: 'Escape' });
        act(() => vi.advanceTimersByTime(180));
        expect(onClose).toHaveBeenCalledOnce();
    });
});
