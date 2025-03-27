"use client";

// React imports
import { useState, useEffect } from "react";

// Wagmi imports
import {
  type BaseError,
  useWaitForTransactionReceipt,
  useConfig,
  useWriteContract,
  useReadContracts,
  useAccount,
} from "wagmi";

// Viem imports
import { parseUnits, formatUnits } from "viem";

// Lucide imports (for icons)
import {
  Ban,
  ExternalLink,
  ChevronDown,
  X,
  Hash,
  LoaderCircle,
  CircleCheck,
  WalletMinimal,
} from "lucide-react";

// Zod imports
import { z } from "zod";

// Zod resolver imports
import { zodResolver } from "@hookform/resolvers/zod";

// React hook form imports
import { useForm } from "react-hook-form";

// UI imports
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useMediaQuery } from "@/hooks/use-media-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

// Utils imports
import { truncateHash } from "@/lib/utils";

// Component imports
import CopyButton from "@/components/copy-button";

// Library imports
import { getSigpassWallet } from "@/lib/sigpass";
import { westendAssetHub } from "@/app/providers";
import { useAtomValue } from "jotai";
import { addressAtom } from "@/components/sigpasskit";
import { Skeleton } from "./ui/skeleton";
import { localConfig } from "@/app/providers";

// Abi for ERC20 Token
import { mockErc20Abi, yieldFarmingAbi } from "@/lib/abi";
import {
  LPTOKEN_CONTRACT_ADDRESS,
  YIELDFARM_CONTRACT_ADDRESS,
} from "@/lib/constants";

export default function StakeForm() {
  // useConfig hook to get config
  const config = useConfig();

  // useAccount hook to get account
  const account = useAccount();

  // useMediaQuery hook to check if the screen is desktop
  const isDesktop = useMediaQuery("(min-width: 768px)");
  // useState hook to open/close dialog/drawer
  const [open, setOpen] = useState(false);

  // get the address from session storage
  const address = useAtomValue(addressAtom);

  // form schema for sending transaction
  const formSchema = z.object({
    // amount is a required field
    amount: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, {
        message: "Amount must be a positive number",
      })
      .refine((val) => /^\d*\.?\d{0,18}$/.test(val), {
        message: "Amount cannot have more than 18 decimal places",
      })
      .superRefine((val, ctx) => {
        if (!maxBalance || !decimals) return;

        const inputAmount = parseUnits(val, decimals as number);

        if (inputAmount > (maxBalance as bigint)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Amount exceeds available balance",
          });
        }
      }),
  });

  // 1. Define your form.
  const form = useForm<z.infer<typeof formSchema>>({
    // resolver is zodResolver
    resolver: zodResolver(formSchema),
    // default values for address and amount
    defaultValues: {
      amount: "",
    },
  });

  // useWriteContract hook to write contract
  const {
    data: hash,
    error,
    isPending,
    writeContractAsync,
  } = useWriteContract({
    config: address ? localConfig : config,
  });
  // useReadContracts hook to read contract
  const { data, refetch } = useReadContracts({
    contracts: [
      {
        address: LPTOKEN_CONTRACT_ADDRESS,
        abi: mockErc20Abi,
        functionName: "balanceOf",
        args: [address ? address : account.address],
      },
      {
        address: LPTOKEN_CONTRACT_ADDRESS,
        abi: mockErc20Abi,
        functionName: "decimals",
      },
      {
        // get the allowance of the selected token
        address: LPTOKEN_CONTRACT_ADDRESS,
        abi: mockErc20Abi,
        functionName: "allowance",
        args: [address ? address : account.address, YIELDFARM_CONTRACT_ADDRESS],
      },
    ],
    config: address ? localConfig : config,
  });

  // get the max balance and decimals from the data
  const maxBalance = data?.[0]?.result as bigint | undefined;
  const decimals = data?.[1]?.result as number | undefined;
  const mintAllowance = data?.[2]?.result as bigint | undefined; // allowance of the selected token

  // extract the amount value from the form
  const amount = form.watch("amount");

  // check if the amount is greater than the mint allowance
  const needsApprove =
    mintAllowance !== undefined && amount
      ? mintAllowance < parseUnits(amount, decimals || 18)
      : false;

  // 2. Define a submit handler.
  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (address) {
      if (needsApprove) {
        writeContractAsync({
          account: await getSigpassWallet(),
          address: LPTOKEN_CONTRACT_ADDRESS,
          abi: mockErc20Abi,
          functionName: "approve",
          args: [
            YIELDFARM_CONTRACT_ADDRESS,
            parseUnits(values.amount, decimals as number),
          ],
          chainId: westendAssetHub.id,
        });
      } else {
        writeContractAsync({
          account: await getSigpassWallet(),
          address: YIELDFARM_CONTRACT_ADDRESS,
          abi: yieldFarmingAbi,
          functionName: "stake",
          args: [parseUnits(values.amount, decimals as number)],
          chainId: westendAssetHub.id,
        });
      }
    } else {
      // Fallback to connected wallet
      if (needsApprove) {
        writeContractAsync({
          address: LPTOKEN_CONTRACT_ADDRESS,
          abi: mockErc20Abi,
          functionName: "approve",
          args: [
            YIELDFARM_CONTRACT_ADDRESS,
            parseUnits(values.amount, decimals as number),
          ],
          chainId: westendAssetHub.id,
        });
      } else {
        writeContractAsync({
          address: YIELDFARM_CONTRACT_ADDRESS,
          abi: yieldFarmingAbi,
          functionName: "stake",
          args: [parseUnits(values.amount, decimals as number)],
          chainId: westendAssetHub.id,
        });
      }
    }
  }

  // Watch for transaction hash and open dialog/drawer when received
  useEffect(() => {
    if (hash) {
      setOpen(true);
    }
  }, [hash]);

  // useWaitForTransactionReceipt hook to wait for transaction receipt
  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({
      hash,
      config: address ? localConfig : config,
    });

  // when isConfirmed, refetch the balance of the address
  useEffect(() => {
    if (isConfirmed) {
      refetch();
    }
  }, [isConfirmed, refetch]);

  return (
    <div className="flex flex-col gap-4 w-[320px] md:w-[425px]">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem>
                <div className="flex flex-row gap-2 items-center justify-between">
                  <FormLabel>Amount to stake</FormLabel>
                  <div className="flex flex-row gap-2 items-center text-xs text-muted-foreground">
                    <WalletMinimal className="w-4 h-4" />{" "}
                    {maxBalance ? (
                      formatUnits(maxBalance as bigint, decimals as number)
                    ) : (
                      <Skeleton className="w-[80px] h-4" />
                    )}{" "}
                    LP Token
                  </div>
                </div>
                <FormControl>
                  {isDesktop ? (
                    <Input
                      type="number"
                      placeholder="0.001"
                      {...field}
                      required
                    />
                  ) : (
                    <Input
                      type="text"
                      inputMode="decimal"
                      pattern="[0-9]*[.]?[0-9]*"
                      placeholder="0.001"
                      {...field}
                      required
                    />
                  )}
                </FormControl>
                <FormDescription>
                  The amount of LPToken to stake
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex flex-row gap-2 items-center justify-between">
            {isPending ? (
              <Button type="submit" disabled className="w-full">
                <LoaderCircle className="w-4 h-4 animate-spin" /> Confirm in
                wallet...
              </Button>
            ) : needsApprove ? (
              <Button type="submit" className="w-full">
                Approve
              </Button>
            ) : (
              <Button disabled className="w-full">
                Approve
              </Button>
            )}
            {isPending ? (
              <Button type="submit" disabled className="w-full">
                <LoaderCircle className="w-4 h-4 animate-spin" /> Confirm in
                wallet...
              </Button>
            ) : needsApprove ? (
              <Button disabled className="w-full">
                Stake
              </Button>
            ) : (
              <Button type="submit" className="w-full">
                Stake
              </Button>
            )}
          </div>
        </form>
      </Form>
      {
        // Desktop would be using dialog
        isDesktop ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="w-full">
                Transaction status <ChevronDown />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Transaction status</DialogTitle>
              </DialogHeader>
              <DialogDescription>
                Follow the transaction status below.
              </DialogDescription>
              <div className="flex flex-col gap-2">
                {hash ? (
                  <div className="flex flex-row gap-2 items-center">
                    <Hash className="w-4 h-4" />
                    Transaction Hash
                    <a
                      className="flex flex-row gap-2 items-center underline underline-offset-4"
                      href={`${config.chains?.[0]?.blockExplorers?.default?.url}/tx/${hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {truncateHash(hash)}
                      <ExternalLink className="w-4 h-4" />
                    </a>
                    <CopyButton copyText={hash} />
                  </div>
                ) : (
                  <div className="flex flex-row gap-2 items-center">
                    <Hash className="w-4 h-4" />
                    No transaction hash
                  </div>
                )}
                {!isPending && !isConfirmed && !isConfirming && (
                  <div className="flex flex-row gap-2 items-center">
                    <Ban className="w-4 h-4" /> No transaction submitted
                  </div>
                )}
                {isConfirming && (
                  <div className="flex flex-row gap-2 items-center text-yellow-500">
                    <LoaderCircle className="w-4 h-4 animate-spin" /> Waiting
                    for confirmation...
                  </div>
                )}
                {isConfirmed && (
                  <div className="flex flex-row gap-2 items-center text-green-500">
                    <CircleCheck className="w-4 h-4" /> Transaction confirmed!
                  </div>
                )}
                {error && (
                  <div className="flex flex-row gap-2 items-center text-red-500">
                    <X className="w-4 h-4" /> Error:{" "}
                    {(error as BaseError).shortMessage || error.message}
                  </div>
                )}
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Close</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : (
          // Mobile would be using drawer
          <Drawer open={open} onOpenChange={setOpen}>
            <DrawerTrigger asChild>
              <Button variant="outline" className="w-full">
                Transaction status <ChevronDown />
              </Button>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>Transaction status</DrawerTitle>
                <DrawerDescription>
                  Follow the transaction status below.
                </DrawerDescription>
              </DrawerHeader>
              <div className="flex flex-col gap-2 p-4">
                {hash ? (
                  <div className="flex flex-row gap-2 items-center">
                    <Hash className="w-4 h-4" />
                    Transaction Hash
                    <a
                      className="flex flex-row gap-2 items-center underline underline-offset-4"
                      href={`${config.chains?.[0]?.blockExplorers?.default?.url}/tx/${hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {truncateHash(hash)}
                      <ExternalLink className="w-4 h-4" />
                      <CopyButton copyText={hash} />
                    </a>
                  </div>
                ) : (
                  <div className="flex flex-row gap-2 items-center">
                    <Hash className="w-4 h-4" />
                    No transaction hash
                  </div>
                )}
                {!isPending && !isConfirmed && !isConfirming && (
                  <div className="flex flex-row gap-2 items-center">
                    <Ban className="w-4 h-4" /> No transaction submitted
                  </div>
                )}
                {isConfirming && (
                  <div className="flex flex-row gap-2 items-center text-yellow-500">
                    <LoaderCircle className="w-4 h-4 animate-spin" /> Waiting
                    for confirmation...
                  </div>
                )}
                {isConfirmed && (
                  <div className="flex flex-row gap-2 items-center text-green-500">
                    <CircleCheck className="w-4 h-4" /> Transaction confirmed!
                  </div>
                )}
                {error && (
                  <div className="flex flex-row gap-2 items-center text-red-500">
                    <X className="w-4 h-4" /> Error:{" "}
                    {(error as BaseError).shortMessage || error.message}
                  </div>
                )}
              </div>
              <DrawerFooter>
                <DrawerClose asChild>
                  <Button variant="outline">Close</Button>
                </DrawerClose>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>
        )
      }
    </div>
  );
}
