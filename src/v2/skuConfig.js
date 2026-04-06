export const SKU_MAP = {
    "5.50": "10000241",
    "6.00": "10000285",
    "6.50": "10000248",
    "7.00": "10000271",
    "8.00": "10000003",
    "9.00": "10000288",
    "10.00": "10000287",
    "12.00": "10000240",
};

export const getSkuByDiameter = (diameter) => {
    const key = parseFloat(diameter).toFixed(2);
    return SKU_MAP[key] || "00000000";
};
