// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {CCTPRegistry} from "../src/CCTPRegistry.sol";

contract DeployCCTPRegistry is Script {
    function run() external {
        vm.startBroadcast();
        CCTPRegistry registry = new CCTPRegistry();
        console.log("CCTPRegistry deployed at:", address(registry));
        vm.stopBroadcast();
    }
}
