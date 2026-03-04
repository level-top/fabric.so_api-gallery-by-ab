"use client";

import * as React from "react";

type Props = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "onContextMenu" | "onDragStart"> & {
    src: string;
    alt: string;
};

export function NoSaveImage(props: Props) {
    const { draggable, src, alt, ...rest } = props;

    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            {...rest}
            src={src}
            alt={alt}
            draggable={draggable ?? false}
            onContextMenu={(e) => {
                e.preventDefault();
            }}
            onDragStart={(e) => {
                e.preventDefault();
            }}
        />
    );
}
