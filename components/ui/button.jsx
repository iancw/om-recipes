import React from 'react';

import { cn } from 'lib/cn';

const variantClasses = {
    default:
        'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:ring-primary/30',
    secondary:
        'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/85 focus-visible:ring-secondary/20',
    outline:
        'border border-border bg-card/80 text-foreground shadow-sm hover:bg-accent/70 focus-visible:ring-primary/20',
    ghost:
        'text-foreground hover:bg-accent/60 focus-visible:ring-primary/20',
    destructive:
        'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 focus-visible:ring-destructive/20',
    link: 'px-0 py-0 h-auto text-primary underline-offset-4 hover:underline focus-visible:ring-primary/20'
};

const sizeClasses = {
    default: 'h-10 px-4 py-2 text-sm',
    sm: 'h-9 rounded-md px-3 text-sm',
    lg: 'h-11 rounded-lg px-6 text-sm',
    icon: 'h-10 w-10'
};

export function buttonVariants({ variant = 'default', size = 'default', className } = {}) {
    return cn(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors outline-none',
        'focus-visible:ring-4 disabled:pointer-events-none disabled:opacity-50',
        variantClasses[variant] ?? variantClasses.default,
        sizeClasses[size] ?? sizeClasses.default,
        className
    );
}

export function Button({ className, variant, size, asChild = false, ...props }) {
    const Component = asChild ? 'span' : 'button';

    return <Component className={buttonVariants({ variant, size, className })} {...props} />;
}
