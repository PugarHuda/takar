// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TakarSettle6} from "../src/TakarSettle6.sol";
import {IERC20} from "../src/TakarSettle.sol";
import {MockUSDC3} from "./TakarSettle3.t.sol";

/// Trade Assurance timing: arrival recorded by the panel's threshold, then the buyer confirms,
/// stays silent (automatic release when the window ends) or objects (the whole panel decides).
contract TakarSettle6Test is Test {
    MockUSDC3 usdc;
    TakarSettle6 s;
    address r1 = address(0xA1);
    address r2 = address(0xA2);
    address r3 = address(0xA3);
    address payer = address(0xB0B);
    address payee = address(0xCAFE);
    uint64 constant WINDOW = 2 days;

    function setUp() public {
        usdc = new MockUSDC3();
        address[] memory rs = new address[](3);
        (rs[0], rs[1], rs[2]) = (r1, r2, r3);
        s = new TakarSettle6(IERC20(address(usdc)), rs, 2, 10 minutes, 1e6);
        usdc.mint(payer, 100e6);
        vm.prank(payer); usdc.approve(address(s), type(uint256).max);
    }

    function _sig(string memory a, string memory b) internal pure returns (bytes32[] memory sig) {
        sig = new bytes32[](2); sig[0] = keccak256(bytes(a)); sig[1] = keccak256(bytes(b));
    }

    function _open(uint64 window) internal returns (uint256 id) {
        vm.prank(payer);
        id = s.open(payee, 10e6, uint64(block.timestamp + 1 hours), TakarSettle6.Kind.Event, "pay on arrival unless the buyer objects", window);
    }

    function _arrive(uint256 id) internal {
        bytes32[] memory sig = _sig("ais", "port-record");
        vm.prank(r1); s.recordArrival(id, sig);
        vm.prank(r2); s.recordArrival(id, sig);
    }

    function test_silentBuyerAutoRelease() public {
        uint256 id = _open(WINDOW);
        _arrive(id);
        assertGt(s.deal(id).arrivedAt, 0, "arrival recorded at the threshold");
        vm.expectRevert("window open");
        s.autoRelease(id);
        vm.warp(block.timestamp + WINDOW);
        vm.prank(address(0xDEAD)); s.autoRelease(id); // anyone, e.g. the keeper
        assertEq(usdc.balanceOf(payee), 10e6, "supplier paid in full");
        assertEq(uint8(s.deal(id).state), uint8(TakarSettle6.State.Settled));
    }

    function test_buyerConfirmsAtOnce() public {
        uint256 id = _open(WINDOW);
        vm.prank(payee); vm.expectRevert("only the buyer"); s.confirm(id);
        vm.prank(payer); s.confirm(id);
        assertEq(usdc.balanceOf(payee), 10e6);
    }

    function test_oneResolverCannotRecordArrival() public {
        uint256 id = _open(WINDOW);
        vm.prank(r1); s.recordArrival(id, _sig("ais", "port-record"));
        assertEq(s.deal(id).arrivedAt, 0, "one backer is not the threshold");
        vm.prank(r1); vm.expectRevert("already backed"); s.recordArrival(id, _sig("ais", "port-record"));
        // A second resolver on different evidence starts a new record rather than completing this one.
        vm.prank(r2); s.recordArrival(id, _sig("ais", "other-record"));
        assertEq(s.deal(id).arrivedAt, 0);
        vm.prank(address(0xBAD)); vm.expectRevert("only resolver"); s.recordArrival(id, _sig("x", "y"));
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert("nothing to release"); s.autoRelease(id);
    }

    function test_buyerObjectsThenWholePanel() public {
        uint256 id = _open(WINDOW);
        _arrive(id);
        vm.prank(payer); s.dispute(id); // objects inside the window, posts the 1 USDC bond
        assertEq(s.required(id), 3, "an objection needs the whole panel");
        vm.warp(block.timestamp + WINDOW);
        vm.expectRevert("buyer objected"); s.autoRelease(id);
        // The panel finds part of the goods short and pays 9 of 10.
        vm.warp(block.timestamp + 1 hours);
        bytes32[] memory sig = _sig("inspection", "reconcile");
        vm.prank(r1); s.propose(id, 9e6, sig, "10% short on inspection");
        bytes32 h = keccak256(abi.encode(uint96(9e6), sig));
        vm.prank(r2); s.second(id, h);
        vm.prank(r3); s.second(id, h);
        vm.warp(block.timestamp + 10 minutes);
        s.finalize(id);
        assertEq(usdc.balanceOf(payee), 9e6);
        assertEq(usdc.balanceOf(payer), 100e6 - 10e6 + 1e6, "refund of 1 plus the bond back: the objection was right");
    }

    function test_objectionOutsideWindowRefused() public {
        uint256 id = _open(WINDOW);
        vm.prank(payer); vm.expectRevert("nothing to dispute"); s.dispute(id); // nothing arrived yet
        _arrive(id);
        vm.warp(block.timestamp + WINDOW);
        vm.prank(payer); vm.expectRevert("window over"); s.dispute(id);
        vm.prank(payee); vm.expectRevert("nothing to dispute"); s.dispute(id); // the supplier cannot object to being paid
    }

    function test_noWindowMeansNoAutoRelease() public {
        uint256 id = _open(0);
        _arrive(id);
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert("nothing to release"); s.autoRelease(id);
    }
}
