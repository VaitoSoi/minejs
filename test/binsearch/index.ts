function binSearch(arr: number[], val: number) {
    let low = 0, high = arr.length - 1, mid = Math.floor((high + low) / 2);
    while (low < high) {
        if (arr[mid] == val) return mid;
        if (low === mid || high === mid) break;
        if (arr[mid]! > val) high = mid;
        else low = mid;
        mid = Math.floor((high + low) / 2);
    }
}
